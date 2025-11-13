const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Traffic Insights API',
      version: '1.0.0',
      description: 'Live traffic, history (default last 60 minutes), and predictions (default 30 minutes). When TOMTOM_API_KEY is configured, /api/traffic/live returns real TomTom data; otherwise simulated.',
    },
    servers: [{ url: 'http://localhost:3001' }],
    tags: [
      { name: 'Health', description: 'Service health' },
      { name: 'Traffic', description: 'Live traffic, history and predictions' }
    ],
    components: {
      parameters: {
        CityParam: {
          in: 'query',
          name: 'city',
          schema: {
            type: 'string',
            enum: ['Bangalore', 'Mumbai', 'Delhi']
          },
          description: 'City to query (default Bangalore). Must be one of: Bangalore, Mumbai, Delhi.'
        }
      }
    }
  },
  apis: ['./src/routes/*.js'], // Path to route API docs
};

const swaggerSpec = swaggerJSDoc(options);

// Add self-test endpoint path dynamically so it shows up in docs even before static spec regeneration.
swaggerSpec.paths = swaggerSpec.paths || {};
swaggerSpec.paths['/api/traffic/self-test'] = {
  get: {
    summary: 'Self-test: verify scheduler is running and observe last ticks',
    description: 'Returns server timestamp, mode (simulated or tomtom), global tick count, and per-city last tick timestamps.',
    tags: ['Health'],
    responses: {
      200: {
        description: 'Scheduler status metrics',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                serverTimestamp: { type: 'string', format: 'date-time' },
                mode: { type: 'string', enum: ['simulated', 'tomtom'] },
                tickCount: { type: 'integer' },
                cities: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      lastTickTimestamp: { type: 'string', format: 'date-time', nullable: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

module.exports = swaggerSpec;
