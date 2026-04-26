import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    setRequestContext(event, context);

    try {
        console.log("Get Pending Tickets Count Request");

        // Scan for pending tickets
        const command = new ScanCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            FilterExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': { S: 'pending' }
            },
            Select: 'COUNT'
        });

        const result = await dynamo.send(command);

        return createResponse(200, {
            success: true,
            message: "Pending tickets count retrieved successfully",
            data: {
                pendingCount: result.Count || 0,
                scannedCount: result.ScannedCount || 0
            }
        });

    } catch (error) {
        console.error("Error getting pending tickets count:", error);

        await logError(error, {
            function: 'getPendingTicketsCount',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
