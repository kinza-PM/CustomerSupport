/**
 * Initialize default statuses after deployment
 * Run this script after deploying the stack
 * 
 * Usage: node scripts/init-default-data.js <stage>
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { PutItemCommand } = require("@aws-sdk/client-dynamodb");

const stage = process.argv[2] || 'dev';
const region = 'eu-west-1';

const dynamo = new DynamoDBClient({ region });

const defaultStatuses = [
    {
        statusId: 'pending',
        name: 'Pending',
        description: 'Ticket is waiting to be reviewed',
        color: '#F59E0B',
        isActive: true
    },
    {
        statusId: 'in-progress',
        name: 'In Progress',
        description: 'Ticket is being worked on',
        color: '#3B82F6',
        isActive: true
    },
    {
        statusId: 'resolved',
        name: 'Resolved',
        description: 'Issue has been resolved',
        color: '#10B981',
        isActive: true
    },
    {
        statusId: 'closed',
        name: 'Closed',
        description: 'Ticket is closed',
        color: '#6B7280',
        isActive: true
    }
];

const defaultReasons = [
    {
        reasonId: 'booking-issues',
        name: 'Booking Issues',
        description: 'Issues related to flight, hotel, or transport bookings',
        isActive: true
    },
    {
        reasonId: 'refund-request',
        name: 'Refund Request',
        description: 'Request for refund or cancellation',
        isActive: true
    },
    {
        reasonId: 'technical-support',
        name: 'Technical Support',
        description: 'Technical issues with the website or app',
        isActive: true
    },
    {
        reasonId: 'general-inquiry',
        name: 'General Inquiry',
        description: 'General questions and inquiries',
        isActive: true
    },
    {
        reasonId: 'other',
        name: 'Other',
        description: 'Other issues not listed above',
        isActive: true
    }
];

async function initializeStatuses() {
    console.log(`\nInitializing default statuses for stage: ${stage}...`);
    
    for (const status of defaultStatuses) {
        try {
            const timestamp = new Date().toISOString();
            
            const command = new PutItemCommand({
                TableName: `ticket-status-${stage}`,
                Item: {
                    statusId: { S: status.statusId },
                    name: { S: status.name },
                    description: { S: status.description },
                    color: { S: status.color },
                    isActive: { BOOL: status.isActive },
                    createdBy: { S: 'system' },
                    createdAt: { S: timestamp },
                    updatedAt: { S: timestamp }
                },
                ConditionExpression: "attribute_not_exists(statusId)"
            });
            
            await dynamo.send(command);
            console.log(`✓ Created status: ${status.name}`);
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
                console.log(`- Status already exists: ${status.name}`);
            } else {
                console.error(`✗ Failed to create status ${status.name}:`, error.message);
            }
        }
    }
}

async function initializeReasons() {
    console.log(`\nInitializing default reasons for stage: ${stage}...`);
    
    for (const reason of defaultReasons) {
        try {
            const timestamp = new Date().toISOString();
            
            const command = new PutItemCommand({
                TableName: `ticket-reasons-${stage}`,
                Item: {
                    reasonId: { S: reason.reasonId },
                    name: { S: reason.name },
                    description: { S: reason.description },
                    isActive: { BOOL: reason.isActive },
                    createdBy: { S: 'system' },
                    createdAt: { S: timestamp },
                    updatedAt: { S: timestamp }
                },
                ConditionExpression: "attribute_not_exists(reasonId)"
            });
            
            await dynamo.send(command);
            console.log(`✓ Created reason: ${reason.name}`);
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
                console.log(`- Reason already exists: ${reason.name}`);
            } else {
                console.error(`✗ Failed to create reason ${reason.name}:`, error.message);
            }
        }
    }
}

async function main() {
    try {
        console.log('='.repeat(60));
        console.log('Customer Support - Initialize Default Data');
        console.log('='.repeat(60));
        
        await initializeStatuses();
        await initializeReasons();
        
        console.log('\n' + '='.repeat(60));
        console.log('Initialization completed!');
        console.log('='.repeat(60));
        console.log('\nYou can now start creating tickets.\n');
    } catch (error) {
        console.error('\nInitialization failed:', error);
        process.exit(1);
    }
}

main();
