import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { 
    createResponse, 
    setRequestContext,
    isValidEmail, 
    isValidPhoneNumber,
    generateTicketId,
    sanitizeInput,
    logError,
    uploadAttachment,
    parseMultipartFormData
} from "../helper/helper.js";
import { logTicketHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let ticketId = null;

    try {
        console.log("Create Ticket Request:", JSON.stringify(event, null, 2));

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

        // Validate required fields
        const { name, email, contact, reason, message } = fields;

        if (!name || !email || !contact || !reason || !message) {
            return createResponse(400, {
                success: false,
                message: "Missing required fields: name, email, contact, reason, message"
            });
        }

        // Validate email
        if (!isValidEmail(email)) {
            return createResponse(422, {
                success: false,
                message: "Invalid email format"
            });
        }

        // Validate contact
        if (!contact.code || !contact.number) {
            return createResponse(422, {
                success: false,
                message: "Contact must include code and number"
            });
        }

        if (!isValidPhoneNumber(contact.code, contact.number)) {
            return createResponse(422, {
                success: false,
                message: "Invalid phone number format"
            });
        }

        // Verify reason exists and is active (lookup by reason name)
        const reasonQuery = await dynamo.send(new QueryCommand({
            TableName: process.env.TICKET_REASONS_TABLE,
            KeyConditionExpression: "#reason = :reason",
            ExpressionAttributeNames: { "#reason": "reason" },
            ExpressionAttributeValues: { ":reason": { S: reason } },
            Limit: 1
        }));
        const reasonCheck = { Item: reasonQuery.Items?.[0] };

        if (!reasonCheck.Item) {
            return createResponse(422, {
                success: false,
                message: "Invalid reason ID"
            });
        }

        if (reasonCheck.Item.status && reasonCheck.Item.status.BOOL === false) {
            return createResponse(422, {
                success: false,
                message: "Selected reason is not active"
            });
        }

        // Generate ticket ID
        ticketId = generateTicketId();
        const timestamp = new Date().toISOString();

        // Handle attachments from formdata files
        let uploadedAttachments = [];
        if (files && files.length > 0) {
            try {
                for (const file of files) {
                    const uploaded = await uploadAttachment(file, ticketId);
                    uploadedAttachments.push(uploaded);
                }
            } catch (error) {
                console.error("Attachment upload failed:", error);
                return createResponse(400, {
                    success: false,
                    message: `Attachment upload failed: ${error.message}`
                });
            }
        }

        // Get default status (pending)
        const defaultStatus = 'pending';

        // Create ticket object
        const ticketData = {
            ticketId: { S: ticketId },
            name: { S: sanitizeInput(name) },
            email: { S: email.toLowerCase() },
            contactCode: { S: contact.code },
            contactNumber: { S: contact.number },
            reason: { S: reason },
            status: { S: defaultStatus },
            message: { S: sanitizeInput(message) },
            attachments: { S: JSON.stringify(uploadedAttachments) },
            createdAt: { S: timestamp },
            updatedAt: { S: timestamp }
        };

        // Save to DynamoDB
        const putCmd = new PutItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Item: ticketData,
            ConditionExpression: "attribute_not_exists(ticketId)"
        });

        await dynamo.send(putCmd);

        // Log history
        await logTicketHistory(
            ticketId,
            'TICKET_CREATED',
            {
                name: sanitizeInput(name),
                email: email.toLowerCase(),
                reason,
                status: defaultStatus,
                attachmentCount: uploadedAttachments.length
            },
            'guest',
            'customer'
        );

        // Return response
        return createResponse(201, {
            success: true,
            message: "Ticket created successfully",
            data: {
                ticketId,
                name: sanitizeInput(name),
                email: email.toLowerCase(),
                contact: {
                    code: contact.code,
                    number: contact.number
                },
                reason,
                status: defaultStatus,
                message: sanitizeInput(message),
                attachments: uploadedAttachments,
                createdAt: timestamp
            }
        });

    } catch (error) {
        console.error("Error creating ticket:", error);

        await logError(error, {
            function: 'createTicket',
            ticketId,
            event: JSON.stringify(event)
        });

        if (error.name === 'ConditionalCheckFailedException') {
            return createResponse(409, {
                success: false,
                message: "Ticket ID already exists"
            });
        }

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
