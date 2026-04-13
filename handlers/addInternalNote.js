import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, sanitizeInput, logError } from "../helper/helper.js";
import { v4 as uuidv4 } from "uuid";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);

    try {
        console.log("Add Internal Note Request:", JSON.stringify(event, null, 2));

        // Get ticket ID from path parameters
        const ticketId = event.pathParameters?.ticketId;
        if (!ticketId) {
            return createResponse(400, {
                success: false,
                message: "Ticket ID is required"
            });
        }

        // Get user info from headers (set by authorizer)
        const userId = event.headers?.user_id || 'unknown';
        const userName = event.headers?.user_name || userId;
        const userType = event.headers?.user_type || 'unknown';

        // Parse request body
        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (error) {
            return createResponse(400, {
                success: false,
                message: "Invalid JSON in request body"
            });
        }

        // Validate note content
        const { note } = body;
        if (!note || !note.trim()) {
            return createResponse(400, {
                success: false,
                message: "Note content is required"
            });
        }

        // Verify ticket exists
        const getTicketCmd = new GetItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: { ticketId: { S: ticketId } }
        });

        const ticketResult = await dynamo.send(getTicketCmd);
        if (!ticketResult.Item) {
            return createResponse(404, {
                success: false,
                message: "Ticket not found"
            });
        }

        // Create internal note
        const noteId = uuidv4();
        const timestamp = new Date().toISOString();

        const noteData = {
            noteId: { S: noteId },
            ticketId: { S: ticketId },
            note: { S: sanitizeInput(note) },
            createdBy: { S: userId },
            createdByName: { S: userName },
            userType: { S: userType },
            createdAt: { S: timestamp }
        };

        const putCmd = new PutItemCommand({
            TableName: process.env.INTERNAL_NOTES_TABLE,
            Item: noteData
        });

        await dynamo.send(putCmd);

        console.log(`✅ Internal note added: ${noteId} for ticket ${ticketId}`);

        return createResponse(201, {
            success: true,
            message: "Internal note added successfully",
            data: {
                noteId,
                ticketId,
                note: sanitizeInput(note),
                createdBy: userId,
                createdByName: userName,
                createdAt: timestamp
            }
        });

    } catch (error) {
        console.error("Error adding internal note:", error);

        await logError(error, {
            function: 'addInternalNote',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
