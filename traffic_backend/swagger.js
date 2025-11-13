const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Traffic Insights API',
      version: '1.0.0',
      description: 'Simulated live traffic, history, and predictions',
    },
    servers: [{ url: 'http://localhost:3001' }],
    tags: [
      { name: 'Health', description: 'Service health' },
      { name: 'Traffic', description: 'Live traffic, history and predictions' }
    ]
  },
  apis: ['./src/routes/*.js'], // Path to route API docs
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
