import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, sanitizeInput, logError, parseMultipartFormData, uploadAttachment } from "../helper/helper.js";
import { logTicketHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let ticketId = null;

    try {
        console.log("Update Ticket Request:", JSON.stringify(event, null, 2));

        // Get ticket ID from path parameters
        ticketId = event.pathParameters?.ticketId;
        if (!ticketId) {
            return createResponse(400, {
                success: false,
                message: "Ticket ID is required"
            });
        }

        // Get user info from headers (set by authorizer)
        const userId = event.headers?.user_id || 'unknown';
        const userType = event.headers?.user_type || 'unknown';

        // Parse request body (supports both JSON and multipart/form-data)
        let fields, files;
        try {
            const parsed = await parseMultipartFormData(event);
            fields = parsed.fields;
            files = parsed.files || [];
        } catch (error) {
            return createResponse(400, {
                success: false,
                message: "Invalid request body: " + error.message
            });
        }
        const body = fields;

        // Check if ticket exists
        const getCmd = new GetItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: { ticketId: { S: ticketId } }
        });

        const existingTicket = await dynamo.send(getCmd);
        if (!existingTicket.Item) {
            return createResponse(404, {
                success: false,
                message: "Ticket not found"
            });
        }

        // Build update expression
        const updateExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};
        const changes = {};

        // Update status
        if (body.status) {
            // Verify status exists
            const statusQuery = await dynamo.send(new QueryCommand({
                TableName: process.env.TICKET_STATUS_TABLE,
                KeyConditionExpression: "Id = :id",
                ExpressionAttributeValues: { ":id": { S: body.status } },
                Limit: 1
            }));

            if (!statusQuery.Items || statusQuery.Items.length === 0) {
                return createResponse(400, {
                    success: false,
                    message: "Invalid status ID"
                });
            }

            const statusItem = statusQuery.Items[0];
            if (statusItem.status && statusItem.status.BOOL === false) {
                return createResponse(400, {
                    success: false,
                    message: "Selected status is not active"
                });
            }

            updateExpressions.push("#status = :status");
            expressionAttributeNames["#status"] = "status";
            expressionAttributeValues[":status"] = { S: body.status };
            changes.status = {
                from: existingTicket.Item.status.S,
                to: body.status
            };
        }

        // Update message (admin notes)
        if (body.adminNotes) {
            updateExpressions.push("adminNotes = :adminNotes");
            expressionAttributeValues[":adminNotes"] = { S: sanitizeInput(body.adminNotes) };
            changes.adminNotes = sanitizeInput(body.adminNotes);
        }

        // Update assignedTo
        if (body.assignedTo) {
            updateExpressions.push("assignedTo = :assignedTo");
            expressionAttributeValues[":assignedTo"] = { S: body.assignedTo };
            changes.assignedTo = {
                from: existingTicket.Item.assignedTo?.S || 'unassigned',
                to: body.assignedTo
            };
        }

        // Update priority
        if (body.priority) {
            updateExpressions.push("priority = :priority");
            expressionAttributeValues[":priority"] = { S: body.priority };
            changes.priority = {
                from: existingTicket.Item.priority?.S || 'normal',
                to: body.priority
            };
        }

        // Handle new attachments from formdata files
        if (files && files.length > 0) {
            try {
                const existingAttachments = existingTicket.Item.attachments?.S 
                    ? JSON.parse(existingTicket.Item.attachments.S) 
                    : [];
                
                const newAttachments = [];
                for (const file of files) {
                    const uploaded = await uploadAttachment(file, ticketId);
                    newAttachments.push(uploaded);
                }
                
                const allAttachments = [...existingAttachments, ...newAttachments];
                updateExpressions.push("attachments = :attachments");
                expressionAttributeValues[":attachments"] = { S: JSON.stringify(allAttachments) };
                changes.attachments = {
                    added: newAttachments.length,
                    total: allAttachments.length
                };
            } catch (error) {
                console.error("Attachment upload failed:", error);
                return createResponse(400, {
                    success: false,
                    message: `Attachment upload failed: ${error.message}`
                });
            }
        }

        if (updateExpressions.length === 0) {
            return createResponse(400, {
                success: false,
                message: "No valid fields to update"
            });
        }

        // Add updatedAt timestamp
        const timestamp = new Date().toISOString();
        updateExpressions.push("updatedAt = :updatedAt");
        expressionAttributeValues[":updatedAt"] = { S: timestamp };

        // Perform update
        const updateCmd = new UpdateItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: { ticketId: { S: ticketId } },
            UpdateExpression: `SET ${updateExpressions.join(", ")}`,
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 
                ? expressionAttributeNames 
                : undefined,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "ALL_NEW"
        });

        const result = await dynamo.send(updateCmd);

        // Log history
        await logTicketHistory(
            ticketId,
            'TICKET_UPDATED',
            changes,
            userId,
            userType
        );

        // Format response
        const updatedTicket = {
            ticketId: result.Attributes.ticketId.S,
            name: result.Attributes.name.S,
            email: result.Attributes.email.S,
            contact: {
                code: result.Attributes.contactCode.S,
                number: result.Attributes.contactNumber.S
            },
            reason: result.Attributes.reason.S,
            status: result.Attributes.status.S,
            message: result.Attributes.message.S,
            attachments: JSON.parse(result.Attributes.attachments.S),
            adminNotes: result.Attributes.adminNotes?.S,
            assignedTo: result.Attributes.assignedTo?.S,
            priority: result.Attributes.priority?.S || 'normal',
            createdAt: result.Attributes.createdAt.S,
            updatedAt: result.Attributes.updatedAt.S
        };

        return createResponse(200, {
            success: true,
            message: "Ticket updated successfully",
            data: updatedTicket
        });

    } catch (error) {
        console.error("Error updating ticket:", error);

        await logError(error, {
            function: 'updateTicket',
            ticketId,
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
