import { GraphQLClient, gql } from 'graphql-request';

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT;
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY;

const graphqlClient = new GraphQLClient(APPSYNC_ENDPOINT, {
  headers: {
    'x-api-key': APPSYNC_API_KEY,
  },
});

// GraphQL Mutations for emitting events
const PUBLISH_TICKET_CREATED = gql`
  mutation PublishTicketCreated($input: TicketCreatedInput!) {
    publishTicketCreated(input: $input) {
      ticketId
      name
      email
      reason
      status
      createdAt
    }
  }
`;

const PUBLISH_TICKET_UPDATED = gql`
  mutation PublishTicketUpdated($input: TicketUpdatedInput!) {
    publishTicketUpdated(input: $input) {
      ticketId
      changes
      updatedAt
    }
  }
`;

/**
 * Emit ticket created event to AppSync
 * @param {Object} ticket - Ticket data
 */
export async function emitTicketCreated(ticket) {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) {
    console.warn('AppSync not configured - event emission skipped');
    return;
  }

  try {
    await graphqlClient.request(PUBLISH_TICKET_CREATED, {
      input: {
        ticketId: ticket.ticketId,
        name: ticket.name,
        email: ticket.email,
        reason: ticket.reason,
        status: ticket.status,
        createdAt: ticket.createdAt
      }
    });
    console.log(`✅ Event emitted: TICKET_CREATED ${ticket.ticketId}`);
  } catch (error) {
    console.error('Failed to emit TICKET_CREATED event:', error.message);
    // Don't throw - event failure shouldn't block ticket creation
  }
}

/**
 * Emit ticket updated event to AppSync
 * @param {string} ticketId - Ticket ID
 * @param {Object} changes - Changes made to ticket
 */
export async function emitTicketUpdated(ticketId, changes) {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) {
    console.warn('AppSync not configured - event emission skipped');
    return;
  }

  try {
    await graphqlClient.request(PUBLISH_TICKET_UPDATED, {
      input: {
        ticketId,
        changes: JSON.stringify(changes),
        updatedAt: new Date().toISOString()
      }
    });
    console.log(`✅ Event emitted: TICKET_UPDATED ${ticketId}`);
  } catch (error) {
    console.error('Failed to emit TICKET_UPDATED event:', error.message);
    // Don't throw - event failure shouldn't block ticket update
  }
}

export default {
  emitTicketCreated,
  emitTicketUpdated
};
