// Request logging middleware
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${req.url}`, {
      status: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
}

module.exports = requestLogger;
