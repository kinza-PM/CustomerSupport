import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);

    try {
        console.log("Get Internal Notes Request:", JSON.stringify(event, null, 2));

        // Get ticket ID from path parameters
        const ticketId = event.pathParameters?.ticketId;
        if (!ticketId) {
            return createResponse(400, {
                success: false,
                message: "Ticket ID is required"
            });
        }

        // Query internal notes by ticketId using GSI
        const queryCmd = new QueryCommand({
            TableName: process.env.INTERNAL_NOTES_TABLE,
            IndexName: 'TicketIdIndex',
            KeyConditionExpression: 'ticketId = :ticketId',
            ExpressionAttributeValues: {
                ':ticketId': { S: ticketId }
            },
            ScanIndexForward: false // Sort by createdAt descending (newest first)
        });

        const result = await dynamo.send(queryCmd);

        // Format notes
        const notes = (result.Items || []).map(item => ({
            noteId: item.noteId.S,
            ticketId: item.ticketId.S,
            note: item.note.S,
            createdBy: item.createdBy.S,
            createdByName: item.createdByName?.S || item.createdBy.S,
            userType: item.userType?.S || 'unknown',
            createdAt: item.createdAt.S
        }));

        console.log(`✅ Retrieved ${notes.length} internal notes for ticket ${ticketId}`);

        return createResponse(200, {
            success: true,
            message: "Internal notes retrieved successfully",
            data: {
                ticketId,
                notes,
                count: notes.length
            }
        });

    } catch (error) {
        console.error("Error retrieving internal notes:", error);

        await logError(error, {
            function: 'getInternalNotes',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
