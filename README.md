# logger-express-nodejs
Module for logging from express js based services



## Example Use
```javascript

//optional config (shown with defaults the module uses)
const loggerConfig = {
                           SENTRY_DSN: process.env.SENTRY_DSN,
                           NODE_ENV: process.env.NODE_ENV,
                           DISABLE_LOGS: process.env.DISABLE_LOGS === "true",
                           handleFallThroughErrors: function(app) {
                             return {}
                           }
                      };

const logger = require("logger")(loggerConfig);

app = express();
logger.requestLogger(app);
app.all("/", function(req, res) {
  return res.sendStatus(200);
});
app.all("/error", function(req, res) {
  return res.sendStatus(500);
});
app.all("/unhandledError", function(req, res) {
  throw new Error("sad panda");
});
app.all("/nextError", function(req, res, next) {
  next({status: 500, body: {errors: [{details: "sad Chewie"}]}});
});
logger.errorLogger(app);

```

## Env Vars
```text
SENTRY_DSN
NODE_ENV
DISABLE_LOGS
```

## Custom Error Fallback
If you would like to define the custom fall through error, set it in the config and pass in the app.
Example:
``` javascript
const loggerConfig = {
  handleFallThroughErrors: function(app) {
    app.use(function (err, req, res, next) {
      // This set the statusCode correctly for uncaught exceptions, no exceptions. ;)
      // this handles situations where res.statusCode is undefined because of an a code exception.
      let statusCode = res.statusCode > 200 ? res.statusCode : 500;

     if (typeof err !== 'object') {
        err = {
          message: String(err)
        };
      } else {
        Object.defineProperty(err, 'message', { enumberable: true });
      }

      res.set('Content-Type', 'application/json');
      res.statusCode = statusCode;
      res.end(JSON.stringify({
        errors: err.results ? err.results.errors : err.message,
        statusCode: statusCode,
        message: err.code
      }));
    })
  }

}
```
If this is not defined a default fallthrough is used.