import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { logTicketHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let ticketId = null;

    try {
        console.log("Delete Ticket Request:", JSON.stringify(event, null, 2));

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

        // Delete attachments from S3
        try {
            const attachments = JSON.parse(existingTicket.Item.attachments.S);
            
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    const deleteCmd = new DeleteObjectCommand({
                        Bucket: process.env.ATTACHMENTS_BUCKET,
                        Key: attachment.key
                    });
                    await s3Client.send(deleteCmd);
                }
            }
        } catch (error) {
            console.error("Error deleting attachments:", error);
            // Continue with ticket deletion even if attachment deletion fails
        }

        // Store ticket data for history
        const ticketData = {
            ticketId: existingTicket.Item.ticketId.S,
            name: existingTicket.Item.name.S,
            email: existingTicket.Item.email.S,
            status: existingTicket.Item.status.S
        };

        // Delete ticket from DynamoDB
        const deleteCmd = new DeleteItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: { ticketId: { S: ticketId } }
        });

        await dynamo.send(deleteCmd);

        // Log history
        await logTicketHistory(
            ticketId,
            'TICKET_DELETED',
            ticketData,
            userId,
            userType
        );

        return createResponse(200, {
            success: true,
            message: "Ticket deleted successfully",
            data: {
                ticketId,
                deletedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("Error deleting ticket:", error);

        await logError(error, {
            function: 'deleteTicket',
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
