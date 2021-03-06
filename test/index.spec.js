const chai = require("chai");
const expect = chai.expect;
const express = require("express");
const logger = require("../index");
const request = require("supertest-as-promised");
const fs = require("fs");
const moment = require("moment-timezone");

let stdout = require("test-console").stdout;
let stderr = require("test-console").stderr;

const customLoggerFallThroughConfig = {
  handleFallThroughErrors: function (app) {
    app.use(function (err, req, res, next) {
      res.set('Content-Type', 'application/json');
      res.end(JSON.stringify({ custom: "MY CUSTOM FALL THROUGH" }));
    });
  }
};

describe("logger-express-nodejs", function () {
  let stdoutInspect,
    stderrInspect,
    app,
    ORIGINAL_NODE_ENV,
    ORIGINAL_SENTRY_DSN,
    ORIGINAL_DISABLE_LOGS;

  beforeEach(function () {
    ORIGINAL_NODE_ENV = process.env.NODE_ENV;
    ORIGINAL_SENTRY_DSN = process.env.SENTRY_DSN;
    ORIGINAL_DISABLE_LOGS = process.env.DISABLE_LOGS;
    stdoutInspect = stdout.inspect();
    stderrInspect = stderr.inspect();
  });

  function checkErrorLogFile(callback) {
    expect(fs.existsSync("./errors.log")).to.be.true;

    let log = fs.readFileSync("./errors.log", "utf8");
    log = JSON.parse(log);
    callback(log);
  }

  function applyLogger(logger) {
    app = express();
    logger.requestLogger(app);
    app.all("/", function (req, res) {
      return res.sendStatus(200);
    });
    app.all("/error", function (req, res) {
      return res.sendStatus(500);
    });
    app.all("/unhandledError", function (req, res) {
      throw new Error("sad panda");
    });
    app.all("/nextError", function (req, res, next) {
      next({ status: 500, body: { errors: [{ details: "sad Chewie" }] } });
    });
    logger.errorLogger(app);
  }

  function restoreEnv() {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (!ORIGINAL_NODE_ENV) delete process.env.NODE_ENV;
    process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
    if (!ORIGINAL_SENTRY_DSN) delete process.env.SENTRY_DSN;
    process.env.DISABLE_LOGS = ORIGINAL_DISABLE_LOGS;
    if (!ORIGINAL_DISABLE_LOGS) delete process.env.DISABLE_LOGS;
  }

  afterEach(function () {
    restoreEnv();
    stdoutInspect.restore();
    stderrInspect.restore();
    //delete errors log
    if (fs.existsSync("./errors.log")) fs.truncateSync("./errors.log");
    if (fs.existsSync("./log/app.log")) fs.unlinkSync("./log/app.log");
    if (fs.existsSync("./log")) fs.rmdirSync("./log");
  });

  it("should output nothing if DISABLE_LOGS is set", function () {
    process.env.DISABLE_LOGS = "true";
    applyLogger(logger());

    return request(app)
      .get("/")
      .then(function (res) {
        stdoutInspect.restore();
        return res;
      })
      .then(function (response) {
        expect(response.statusCode).to.eql(200);
        expect(stdoutInspect.output.length).to.eq(0);
      });
  });
  it("should output timezone-corrected timestamp with log", function () {
    applyLogger(logger());

    return request(app)
      .get("/")
      .then(function (res) {
        stdoutInspect.restore();
        return res;
      })
      .then(function (response) {
        const time = moment()
          .tz("America/Chicago")
          .format("YYYY-MM-DD");
        const timeMatch = new RegExp(time, "g");

        // Matches current Year-Month-Day with the log timestamp
        expect(stdoutInspect.output).to.match(timeMatch);
      });
  });
  it("should correctly return error info response on error when logging is off", function () {
    process.env.DISABLE_LOGS = "true";
    applyLogger(logger());

    return request(app)
      .get("/nextError")
      .then(function (res) {
        stdoutInspect.restore();
        stderrInspect.restore();
        return res;
      })
      .then(function (response) {
        expect(response.statusCode).to.eql(500);
        expect(response.body.errors).to.eql([{ details: "sad Chewie" }]);
        expect(stdoutInspect.output.length).to.eq(0);
      });
  });
  it("should respect CREATE_LOG_DIR option", function () {
    applyLogger(logger());

    expect(fs.existsSync("./log")).to.be.true;
  });

  it("should not throw error if file already exists", function () {
    fs.mkdirSync("./log");
    applyLogger(logger());
    stdoutInspect.restore();
    stderrInspect.restore();
    expect(stderrInspect.output.length).to.eq(0);
  });

  it("should ignore ELB-HealthChecker requests", function () {
    applyLogger(logger());

    request(app)
      .get("/")
      .set('User-Agent', "ELB-HealthChecker/2.0")
      .then(function (res) {
        stdoutInspect.restore();
        return res;
      })
      .then(function (res) {
        expect(stdoutInspect.output.length).to.eq(1);
        // The output from this test ends up in stdout...
        expect(stdoutInspect.output).to.match(/should ignore ELB-HealthChecker/);
      }).catch((err) => {
        console.log(err);
      });
  });

  describe("production logger", function () {
    beforeEach(function () {
      process.env.NODE_ENV = "SomeOtherEnvThatIsNotDevelopment";
    });

    it("should output sentry DSN missing error when no DSN is used", function () {
      applyLogger(logger());
      stderrInspect.restore();
      expect(stderrInspect.output.length).to.eq(0);

    });
    it("should output logs for errors", function () {
      applyLogger(logger());

      return request(app)
        .get("/error")
        .then(function (res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function (response) {
          expect(response.statusCode).to.eql(500);
          expect(stdoutInspect.output).to.match(
            /error 500 \d\d*ms statusCode=500, url=\/error, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/error, , responseTime=\d+\n/
          );
          //this endpoint doesn't hit the error logger as it's responding directly with a 500
        });
    });
    it("should output timezone-corrected timestamp with log", function () {
      applyLogger(logger());

      return request(app)
        .get("/")
        .then(function (res) {
          stdoutInspect.restore();
          return res;
        })
        .then(function (response) {
          const time = moment()
            .tz("America/Chicago")
            .format("YYYY-MM-DD");
          const timeMatch = new RegExp(time, "g");

          // Matches current Year-Month-Day with the log timestamp
          expect(stdoutInspect.output).to.match(timeMatch);
        });
    });
    it("should output logs for unhandled errors", function (done) {
      applyLogger(logger());

      request(app)
        .get("/unhandledError")
        .then(function (res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function (response) {
          expect(response.statusCode).to.eql(500);
          expect(stdoutInspect.output).to.match(
            /unhandledError 500 \d+ms statusCode=500, url=\/unhandledError, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/unhandledError, , responseTime=\d+\n/
          );

          setTimeout(function () {
            checkErrorLogFile(function (log) {
              expect(log.stack[0]).to.be.match(/Error: sad panda/);
              expect(log.stack.length).to.be.greaterThan(2);
              expect(log.trace.length).to.be.greaterThan(2);
              done();
            });
          }, 100);
        });
    });
    it("should output logs for errors passed from downstream api calls", function (done) {
      applyLogger(logger());

      request(app)
        .get("/nextError")
        .then(function (res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function (response) {
          expect(response.statusCode).to.eql(500);
          expect(response.body.errors).to.eql([{ details: "sad Chewie" }]);

          expect(stdoutInspect.output.join(" ")).to.match(
            /nextError 500 \d+ms statusCode=500, url=\/nextError, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/nextError, , responseTime=\d+\n/
          );
          setTimeout(function () {
            checkErrorLogFile(function (log) {
              expect(log.req.url).to.match(/\/nextError/);
              expect(log.message).to.match(/middlewareError/);
              done();
            });
          }, 500);
        });
    });
    it("should allow custom error handling", function (done) {
      applyLogger(logger(customLoggerFallThroughConfig));
      request(app)
        .get("/nextError")
        .then(function (res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function (response) {
          setTimeout(function () {
            expect(response.body.custom).to.eq("MY CUSTOM FALL THROUGH");
            done();
          }, 500);
        });
    });
  });
});
