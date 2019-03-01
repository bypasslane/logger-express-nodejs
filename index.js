const moment = require("moment-timezone");
const fs = require("fs");

function logging(config) {
  let requestLogger = function () { };
  let errorLogger = handleFallThroughErrors;

  function setLogging() {
    const winston = require("winston");
    const expressWinston = require("express-winston");

    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV
    });

    requestLogger = function (app) {
      app.use(Sentry.Handlers.requestHandler());
      app.use(
        expressWinston.logger({
          transports: [
            new winston.transports.Console({
              json: false,
              colorize: config.NODE_ENV === "development" || config.COLORIZE,
              level: "info",
              timestamp: timeZoneStamp
            }),
            new winston.transports.File({
              filename: "./log/app.log",
              json: true,
              timestamp: timeZoneStamp
            })
          ],
          expressFormat: true,
          colorize: config.NODE_ENV === "development" || config.COLORIZE,
          ignoreRoute: filterLogs,
          ignoredRoutes: ["/status"]
        })
      );
    };

    errorLogger = function (app) {
      app.use(Sentry.Handlers.errorHandler());
      app.use(
        expressWinston.errorLogger({
          transports: [
            new winston.transports.File({
              filename: "./errors.log",
              // File will only record errors
              level: "error",
              json: true,
              colorize: config.NODE_ENV === "development" || config.COLORIZE,
              timestamp: timeZoneStamp
            }),
            new winston.transports.Console({
              level: "error",
              json: false,
              colorize: config.NODE_ENV === "development" || config.COLORIZE,
              timestamp: timeZoneStamp
            })
          ]
        })
      );
      // If a callback is defined use that instead of the default handler
      config.handleFallThroughErrors(app);
    };
  }

  function timeZoneStamp() {
    var currentTime = moment()
      .tz("America/Chicago")
      .format();
    return currentTime;
  }

  function filterLogs(req) {
    if (req && req.headers["user-agent"] && req.headers["user-agent"].includes("ELB-HealthChecker")) return true;
  }

  function processConfig() {
    config = config || {};
    config = {
      SENTRY_DSN: config.SENTRY_DSN || process.env.SENTRY_DSN,
      NODE_ENV: config.NODE_ENV || process.env.NODE_ENV,
      DISABLE_LOGS: config.DISABLE_LOGS || process.env.DISABLE_LOGS === "true",
      CLUSTER_NAME: config.CLUSTER_NAME || process.env.CLUSTER_NAME,
      handleFallThroughErrors: config.handleFallThroughErrors || handleFallThroughErrors
    };
    // create log folder
    try { fs.mkdirSync('./log'); }
    catch (e) { console.log('./log directory already exists, skipping creation'); }
  }

  // Default handleFallThroughErrors if none are defined in the config
  function handleFallThroughErrors(app) {
    app.use(function (err, req, res, next) {
      res.status(err.status || 500);
      res.json({ errors: mergeErrors(err) });
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
  }

  function init() {
    processConfig();
    if (!config.DISABLE_LOGS) {
      setLogging();
    }
  }

  init();

  this.requestLogger = requestLogger;
  this.errorLogger = errorLogger;
  return this;
}


module.exports = logging;
