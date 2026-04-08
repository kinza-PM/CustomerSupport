import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    setRequestContext(event, context);

    try {
        console.log("Get Reasons Request:", JSON.stringify(event, null, 2));

        // Scan for all active reasons
        const scanCommand = new ScanCommand({
            TableName: process.env.TICKET_REASONS_TABLE,
            FilterExpression: "#status = :status",
            ExpressionAttributeNames: {
                "#status": "status"
            },
            ExpressionAttributeValues: {
                ":status": { BOOL: true }
            }
        });

        const result = await dynamo.send(scanCommand);

        // Transform DynamoDB format to simple object
        const reasons = (result.Items || []).map(item => ({
            id: item.id?.S || '',
            reason: item.reason?.S || '',
            status: item.status?.BOOL || false,
            createdAt: item.createdAt?.N ? parseInt(item.createdAt.N) : null,
            updatedAt: item.updatedAt?.N ? parseInt(item.updatedAt.N) : null
        }));

        return createResponse(200, {
            success: true,
            data: reasons,
            count: reasons.length
        });

    } catch (error) {
        console.error("Error fetching reasons:", error);
        return createResponse(500, {
            success: false,
            message: "Failed to fetch reasons",
            error: error.message
        });
    }
};
