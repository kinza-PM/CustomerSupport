import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

/**
 * Log ticket history
 */
async function logTicketHistory(ticketId, action, changes, userId, userType) {
    try {
        const historyId = uuidv4();
        const timestamp = new Date().toISOString();

        const putCmd = new PutItemCommand({
            TableName: process.env.TICKET_HISTORY_TABLE,
            Item: {
                historyId: { S: historyId },
                ticketId: { S: ticketId },
                action: { S: action },
                changes: { S: JSON.stringify(changes) },
                userId: { S: userId || 'system' },
                userType: { S: userType || 'system' },
                timestamp: { S: timestamp }
            }
        });

        await dynamo.send(putCmd);
        return historyId;
    } catch (error) {
        console.error("Failed to log ticket history:", error);
        throw error;
    }
}

/**
 * Get ticket history
 */
async function getTicketHistory(ticketId) {
    try {
        
        const queryCmd = new QueryCommand({
            TableName: process.env.TICKET_HISTORY_TABLE,
            IndexName: 'TicketIdIndex',
            KeyConditionExpression: 'ticketId = :ticketId',
            ExpressionAttributeValues: {
                ':ticketId': { S: ticketId }
            },
            ScanIndexForward: false // Sort by timestamp descending
        });

        const result = await dynamo.send(queryCmd);
        
        return result.Items.map(item => ({
            historyId: item.historyId.S,
            ticketId: item.ticketId.S,
            action: item.action.S,
            changes: JSON.parse(item.changes.S),
            userId: item.userId.S,
            userType: item.userType.S,
            timestamp: item.timestamp.S
        }));
    } catch (error) {
        console.error("Failed to get ticket history:", error);
        throw error;
    }
}

export {
    logTicketHistory,
    getTicketHistory
};
