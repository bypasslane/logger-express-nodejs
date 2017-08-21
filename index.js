function logging(config) {
  let requestLogger = function() {};
  let errorLogger = function() {};

  function setDevelopmentLogging() {
    const morgan = require("morgan");
    requestLogger = function(app) {
      app.use(morgan("dev"));
    };
  }

  function setProductionLogging() {
    const winston = require("winston");
    const expressWinston = require("express-winston");
    const Sentry = require("winston-raven-sentry");
    const sentryOptions = {
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      level: "error"
    };
    let logger = new winston.Logger();
    logger.add(Sentry, sentryOptions);

    requestLogger = function(app) {
      app.use(logger.transports.sentry.raven.requestHandler());
      app.use(
        expressWinston.logger({
          transports: [
            new winston.transports.Console({
              json: false,
              colorize: true
            })
          ],
          expressFormat: true,
          colorize: true,
          ignoredRoutes: ["/status"]
        })
      );
    };

    errorLogger = function(app) {
      app.use(logger.transports.sentry.raven.errorHandler());
      app.use(
        expressWinston.errorLogger({
          transports: [
            new winston.transports.File({
              filename: "./errors.log",
              // File will only record errors
              level: "error",
              json: true
            })
          ]
        })
      );
      app.use(
        expressWinston.errorLogger({
          transports: [
            new winston.transports.Console({
              level: "error",
              json: false,
              colorize: true
            })
          ]
        })
      );

      app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.json({errors: mergeErrors(err)});
      });

      function mergeErrors(err) {
        let errors = [];

        if (err.detail || err.message) {
          errors.push({
            detail: err.detail || err.message
          });
        }
        if (err.body && err.body.errors) {
          errors = errors.concat(err.body.errors);
        }
        return errors;
      }
    };
  }

  function processConfig() {
    config = config || {};
    config = {
      SENTRY_DSN: config.SENTRY_DSN || process.env.SENTRY_DSN,
      NODE_ENV: config.NODE_ENV || process.env.NODE_ENV,
      DISABLE_LOGS: config.DISABLE_LOGS || process.env.DISABLE_LOGS === "true"
    };
  }

  function init() {
    processConfig();
    if (!config.DISABLE_LOGS) {
      if (process.env.NODE_ENV === "development") {
        setDevelopmentLogging();
      } else {
        setProductionLogging();
      }
    }
  }

  init();

  this.requestLogger = requestLogger;
  this.errorLogger = errorLogger;
  return this;
}

module.exports = logging;
