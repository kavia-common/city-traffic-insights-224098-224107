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
module.exports = swaggerSpec;
