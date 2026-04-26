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
        const { 
            status, 
            email, 
            assignedTo, 
            category,
            priority,
            search,
            dateFrom,
            dateTo,
            ageFilter,
            limit, 
            lastEvaluatedKey, 
            all 
        } = queryParams;

        // Build filter expressions for Scan
        let filterExpressions = [];
        let expressionAttributeNames = {};
        let expressionAttributeValues = {};

        // Status filter
        if (status && status !== 'All') {
            filterExpressions.push('#status = :status');
            expressionAttributeNames['#status'] = 'status';
            expressionAttributeValues[':status'] = { S: status };
        }

        // Email filter
        if (email) {
            filterExpressions.push('email = :email');
            expressionAttributeValues[':email'] = { S: email.toLowerCase() };
        }

        // AssignedTo filter
        if (assignedTo && assignedTo !== 'All') {
            filterExpressions.push('assignedTo = :assignedTo');
            expressionAttributeValues[':assignedTo'] = { S: assignedTo };
        }

        // Category/Reason filter
        if (category && category !== 'All') {
            filterExpressions.push('reason = :reason');
            expressionAttributeValues[':reason'] = { S: category };
        }

        // Priority filter
        if (priority && priority !== 'All') {
            filterExpressions.push('priority = :priority');
            expressionAttributeValues[':priority'] = { S: priority };
        }

        // Search filter (searches in ticketId, name, email, message)
        // Note: DynamoDB doesn't support case-insensitive search, so we use contains() which is case-sensitive
        if (search && search.trim()) {
            const searchTerm = search.trim();
            filterExpressions.push('(contains(ticketId, :search) OR contains(#name, :search) OR contains(email, :search) OR contains(#message, :search))');
            expressionAttributeNames['#name'] = 'name';
            expressionAttributeNames['#message'] = 'message';
            expressionAttributeValues[':search'] = { S: searchTerm };
        }

        // Date range filter
        if (dateFrom) {
            filterExpressions.push('createdAt >= :dateFrom');
            expressionAttributeValues[':dateFrom'] = { S: dateFrom };
        }
        if (dateTo) {
            filterExpressions.push('createdAt <= :dateTo');
            expressionAttributeValues[':dateTo'] = { S: dateTo };
        }

        // Age filter (show tickets older than threshold)
        if (ageFilter && ageFilter !== 'All') {
            console.log('🔍 Age filter received:', ageFilter);
            const now = new Date();
            let thresholdDate;
            
            if (ageFilter === '24h') {
                thresholdDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            } else if (ageFilter === '3d') {
                thresholdDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
            } else if (ageFilter === '7d') {
                thresholdDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            }
            
            if (thresholdDate) {
                console.log('📅 Age threshold date:', thresholdDate.toISOString());
                // Show tickets created BEFORE the threshold (older tickets)
                filterExpressions.push('createdAt < :ageThreshold');
                expressionAttributeValues[':ageThreshold'] = { S: thresholdDate.toISOString() };
            }
        }

        // Build Scan command with filters (NO LIMIT - fetch all for proper sorting)
        let commandParams = {
            TableName: process.env.SUPPORT_TICKETS_TABLE
        };

        // Add filter expression if any filters are applied
        if (filterExpressions.length > 0) {
            commandParams.FilterExpression = filterExpressions.join(' AND ');
        }
        if (Object.keys(expressionAttributeNames).length > 0) {
            commandParams.ExpressionAttributeNames = expressionAttributeNames;
        }
        if (Object.keys(expressionAttributeValues).length > 0) {
            commandParams.ExpressionAttributeValues = expressionAttributeValues;
        }

        // Fetch ALL matching tickets (no pagination limit)
        const command = new ScanCommand(commandParams);
        let allItems = [];
        let result = await dynamo.send(command);
        allItems = allItems.concat(result.Items);

        // Continue scanning if there are more items
        while (result.LastEvaluatedKey) {
            command.ExclusiveStartKey = result.LastEvaluatedKey;
            result = await dynamo.send(command);
            allItems = allItems.concat(result.Items);
        }

        // Get complete stats from full table scan (without pagination limit)
        const statsCommand = new ScanCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            ProjectionExpression: '#status, createdAt, assignedTo, priority',
            ExpressionAttributeNames: {
                '#status': 'status'
            }
        });
        
        let allStatsItems = [];
        let statsResult = await dynamo.send(statsCommand);
        allStatsItems = allStatsItems.concat(statsResult.Items);
        
        // Continue scanning if there are more items
        while (statsResult.LastEvaluatedKey) {
            statsCommand.ExclusiveStartKey = statsResult.LastEvaluatedKey;
            statsResult = await dynamo.send(statsCommand);
            allStatsItems = allStatsItems.concat(statsResult.Items);
        }

        // Format and sort ALL tickets by createdAt descending (newest first)
        const allTickets = allItems.map(item => ({
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
            source: item.source?.S,
            conversationId: item.conversationId?.S,
            category: item.category?.S,
            subcategory: item.subcategory?.S,
            createdAt: item.createdAt.S,
            updatedAt: item.updatedAt.S
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Apply pagination to sorted results
        const pageSize = limit ? parseInt(limit) : 10;
        const startIndex = lastEvaluatedKey ? parseInt(lastEvaluatedKey) : 0;
        const endIndex = startIndex + pageSize;
        const tickets = allTickets.slice(startIndex, endIndex);

        // Calculate statistics from ALL tickets
        const now = new Date();
        const slaThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        const stats = {
            openTickets: allStatsItems.filter(item => 
                item.status.S === 'open' || item.status.S === 'pending'
            ).length,
            slaBreached: allStatsItems.filter(item => {
                const isOpen = item.status.S === 'open' || item.status.S === 'pending';
                const createdAt = new Date(item.createdAt.S);
                return isOpen && createdAt < slaThreshold;
            }).length,
            unassignedTickets: allStatsItems.filter(item => 
                !item.assignedTo || !item.assignedTo.S
            ).length,
            escalatedTickets: allStatsItems.filter(item => 
                item.priority?.S === 'high' || item.priority?.S === 'urgent'
            ).length
        };

        // Create pagination token (use index-based pagination)
        let nextToken = null;
        if (endIndex < allTickets.length) {
            nextToken = endIndex.toString();
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
                nextToken,
                stats
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
