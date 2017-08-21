# logger-express-nodejs
Module for logging from express js based services



## Example Use
```javascript

//optional config (shown with defaults the module uses)
const loggerConfig = {
                           SENTRY_DSN: process.env.SENTRY_DSN,
                           NODE_ENV: process.env.NODE_ENV,
                           DISABLE_LOGS: process.env.DISABLE_LOGS === "true"
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
