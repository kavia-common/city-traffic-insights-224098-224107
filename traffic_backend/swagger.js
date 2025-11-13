const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Traffic Insights API',
      version: '1.0.0',
      description: 'Live traffic, history, and predictions. When TOMTOM_API_KEY is configured, /api/traffic/live returns real TomTom Traffic Flow data; otherwise simulated data is returned. Query parameters remain unchanged.',
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
          description: 'City to query (default Bangalore)'
        }
      }
    }
  },
  apis: ['./src/routes/*.js'], // Path to route API docs
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
