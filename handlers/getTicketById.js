import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { getTicketHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let ticketId = null;

    try {
        console.log("Get Ticket By ID Request:", JSON.stringify(event, null, 2));

        // Get ticket ID from path parameters
        ticketId = event.pathParameters?.ticketId;
        if (!ticketId) {
            return createResponse(400, {
                success: false,
                message: "Ticket ID is required"
            });
        }

        // Get query parameters
        const queryParams = event.queryStringParameters || {};
        const includeHistory = queryParams.includeHistory === 'true';

        // Get ticket
        const getCmd = new GetItemCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: { ticketId: { S: ticketId } }
        });

        const result = await dynamo.send(getCmd);

        if (!result.Item) {
            return createResponse(404, {
                success: false,
                message: "Ticket not found"
            });
        }

        // Format ticket
        const ticket = {
            ticketId: result.Item.ticketId.S,
            name: result.Item.name.S,
            email: result.Item.email.S,
            contact: {
                code: result.Item.contactCode.S,
                number: result.Item.contactNumber.S
            },
            reason: result.Item.reason.S,
            status: result.Item.status.S,
            message: result.Item.message.S,
            attachments: JSON.parse(result.Item.attachments.S),
            adminNotes: result.Item.adminNotes?.S,
            assignedTo: result.Item.assignedTo?.S,
            priority: result.Item.priority?.S || 'normal',
            createdAt: result.Item.createdAt.S,
            updatedAt: result.Item.updatedAt.S
        };

        // Get history if requested
        let history = null;
        if (includeHistory) {
            history = await getTicketHistory(ticketId);
        }

        // Log trace
        // await sendLogTrace({
        //     action: 'GET_TICKET_BY_ID',
        //     ticketId,
        //     includeHistory,
        //     duration: Date.now() - startTime
        // });

        return createResponse(200, {
            success: true,
            message: "Ticket retrieved successfully",
            data: {
                ticket,
                ...(history && { history })
            }
        });

    } catch (error) {
        console.error("Error getting ticket:", error);

        await logError(error, {
            function: 'getTicketById',
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
