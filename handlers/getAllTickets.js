import { DynamoDBClient, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);

    try {
        console.log("Get All Tickets Request:", JSON.stringify(event, null, 2));

        // Get query parameters
        const queryParams = event.queryStringParameters || {};
        const { status, email, assignedTo, limit, lastEvaluatedKey, all } = queryParams;

        // Require at least one filter to avoid expensive Scan operations
        if (!status && !email && !assignedTo && all !== 'true') {
            return createResponse(400, {
                success: false,
                message: "At least one filter (status, email, or assignedTo) is required"
            });
        }

        let command;

        // Allow fetching all tickets with all=true parameter
        if (all === 'true') {
            command = new ScanCommand({
                TableName: process.env.SUPPORT_TICKETS_TABLE,
                Limit: limit ? parseInt(limit) : 50,
                ...(lastEvaluatedKey && {
                    ExclusiveStartKey: JSON.parse(
                        Buffer.from(lastEvaluatedKey, 'base64').toString('utf-8')
                    )
                })
            });
        } else {
            let commandParams = {
                TableName: process.env.SUPPORT_TICKETS_TABLE,
                Limit: limit ? parseInt(limit) : 50
            };

            // Add pagination
            if (lastEvaluatedKey) {
                try {
                    commandParams.ExclusiveStartKey = JSON.parse(
                        Buffer.from(lastEvaluatedKey, 'base64').toString('utf-8')
                    );
                } catch (error) {
                    return createResponse(400, {
                        success: false,
                        message: "Invalid pagination token"
                    });
                }
            }

        // Query by status using GSI
        if (status) {
            commandParams.IndexName = 'StatusIndex';
            commandParams.KeyConditionExpression = '#status = :status';
            commandParams.ExpressionAttributeNames = { '#status': 'status' };
            commandParams.ExpressionAttributeValues = { ':status': { S: status } };
            commandParams.ScanIndexForward = false; // Sort by createdAt descending
            
            command = new QueryCommand(commandParams);
        }
        // Query by email using GSI
        else if (email) {
            commandParams.IndexName = 'EmailIndex';
            commandParams.KeyConditionExpression = 'email = :email';
            commandParams.ExpressionAttributeValues = { ':email': { S: email.toLowerCase() } };
            commandParams.ScanIndexForward = false;
            
            command = new QueryCommand(commandParams);
        }
        // Query by assignedTo using GSI
        else if (assignedTo) {
            commandParams.IndexName = 'AssignedToIndex';
            commandParams.KeyConditionExpression = 'assignedTo = :assignedTo';
            commandParams.ExpressionAttributeValues = { ':assignedTo': { S: assignedTo } };
            commandParams.ScanIndexForward = false;
            
            command = new QueryCommand(commandParams);
        }
        }

        const result = await dynamo.send(command);

        // Format tickets
        const tickets = result.Items.map(item => ({
            ticketId: item.ticketId.S,
            name: item.name.S,
            email: item.email.S,
            contact: {
                code: item.contactCode.S,
                number: item.contactNumber.S
            },
            reason: item.reason.S,
            status: item.status.S,
            message: item.message.S,
            attachments: JSON.parse(item.attachments.S),
            adminNotes: item.adminNotes?.S,
            assignedTo: item.assignedTo?.S,
            priority: item.priority?.S || 'normal',
            createdAt: item.createdAt.S,
            updatedAt: item.updatedAt.S
        }));

        // Create pagination token
        let nextToken = null;
        if (result.LastEvaluatedKey) {
            nextToken = Buffer.from(
                JSON.stringify(result.LastEvaluatedKey)
            ).toString('base64');
        }

        // Log trace
        // await sendLogTrace({
        //     action: 'GET_ALL_TICKETS',
        //     filters: { status, email },
        //     count: tickets.length,
        //     duration: Date.now() - startTime
        // });

        return createResponse(200, {
            success: true,
            message: "Tickets retrieved successfully",
            data: {
                tickets,
                count: tickets.length,
                nextToken
            }
        });

    } catch (error) {
        console.error("Error getting tickets:", error);

        await logError(error, {
            function: 'getAllTickets',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
