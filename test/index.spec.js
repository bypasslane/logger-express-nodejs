const chai = require("chai");
const expect = chai.expect;
const stripColor = require("strip-color");
const express = require("express");
const logger = require("../index");
const request = require("supertest-as-promised");
const fs = require("fs");

let stdout = require("test-console").stdout;
let stderr = require("test-console").stderr;

describe("logger-express-nodejs", function() {
  let stdoutInspect,
    stderrInspect,
    app,
    ORIGINAL_NODE_ENV,
    ORIGINAL_SENTRY_DSN,
    ORIGINAL_DISABLE_LOGS;

  beforeEach(function() {
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
  }

  function restoreEnv() {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (!ORIGINAL_NODE_ENV) delete process.env.NODE_ENV;
    process.env.SENTRY_DSN = ORIGINAL_SENTRY_DSN;
    if (!ORIGINAL_SENTRY_DSN) delete process.env.SENTRY_DSN;
    process.env.DISABLE_LOGS = ORIGINAL_DISABLE_LOGS;
    if (!ORIGINAL_DISABLE_LOGS) delete process.env.DISABLE_LOGS;
  }

  afterEach(function() {
    restoreEnv();
    stdoutInspect.restore();
    stderrInspect.restore();
    //delete errors log
    if (fs.existsSync("./errors.log")) fs.truncateSync("./errors.log");
  });

  it("should output to the console using morgan when in development mode", function() {
    let morganConsoleOutput = /GET [/] 200 \d\d*\.\d{3} ms - 2/;
    process.env.NODE_ENV = "development";
    applyLogger(logger());

    return request(app)
      .get("/")
      .then(function(res) {
        stdoutInspect.restore();
        return res;
      })
      .then(function(response) {
        expect(response.statusCode).to.eql(200);
        expect(stripColor(stdoutInspect.output[0])).to.match(
          morganConsoleOutput
        );
      });
  });
  it("should output nothing if DISABLE_LOGS is set", function() {
    process.env.DISABLE_LOGS = "true";
    applyLogger(logger());

    return request(app)
      .get("/")
      .then(function(res) {
        stdoutInspect.restore();
        return res;
      })
      .then(function(response) {
        expect(response.statusCode).to.eql(200);
        expect(stdoutInspect.output.length).to.eq(0);
      });
  });
  it("should correctly return error info response on error when logging is off", function() {
    process.env.DISABLE_LOGS = "true";
    applyLogger(logger());

    return request(app)
      .get("/nextError")
      .then(function(res) {
        stdoutInspect.restore();
        stderrInspect.restore();
        return res;
      })
      .then(function(response) {
        expect(response.statusCode).to.eql(500);
        expect(response.body.errors).to.eql([{details: "sad Chewie"}]);
        expect(stdoutInspect.output.length).to.eq(0);
      });
  });

  describe("production logger", function() {
    beforeEach(function() {
      process.env.NODE_ENV = "SomeOtherEnvThatIsNotDevelopment";
    });

    it("should output sentry DSN missing error when no DSN is used", function() {
      applyLogger(logger());
      stdoutInspect.restore();
      expect(stdoutInspect.output[0]).to.match(
        /raven@2\.1\.1 alert: no DSN provided, error reporting disabled/
      );
    });
    it("should output logs for errors", function() {
      applyLogger(logger());

      return request(app)
        .get("/error")
        .then(function(res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function(response) {
          expect(response.statusCode).to.eql(500);
          expect(stripColor(stdoutInspect.output[1])).to.match(
            /error 500 \d\d*ms statusCode=500, url=\/error, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/error, , responseTime=\d+\n/
          );
          //this endpoint doesn't hit the error logger as it's responding directly with a 500
        });
    });
    it("should output logs for unhandled errors", function(done) {
      applyLogger(logger());

      request(app)
        .get("/unhandledError")
        .then(function(res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function(response) {
          expect(response.statusCode).to.eql(500);
          expect(stripColor(stdoutInspect.output[1])).to.match(
            /unhandledError 500 \d+ms statusCode=500, url=\/unhandledError, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/unhandledError, , responseTime=\d+\n/
          );

          setTimeout(function() {
            checkErrorLogFile(function(log) {
              expect(log.stack[0]).to.be.match(/Error: sad panda/);
              expect(log.stack.length).to.be.greaterThan(2);
              expect(log.trace.length).to.be.greaterThan(2);
              done();
            });
          }, 100);
        });
    });
    it("should output logs for errors passed from downstream api calls", function(
      done
    ) {
      applyLogger(logger());

      request(app)
        .get("/nextError")
        .then(function(res) {
          stdoutInspect.restore();
          stderrInspect.restore();
          return res;
        })
        .then(function(response) {
          expect(response.statusCode).to.eql(500);
          expect(response.body.errors).to.eql([{details: "sad Chewie"}]);
          expect(stripColor(stdoutInspect.output[1])).to.match(
            /nextError 500 \d+ms statusCode=500, url=\/nextError, .+ connection=close, method=GET, httpVersion=.{3,4}, originalUrl=\/nextError, , responseTime=\d+\n/
          );
          setTimeout(function() {
            checkErrorLogFile(function(log) {
              expect(log.req.url).to.match(/\/nextError/);
              expect(log.message).to.match(/middlewareError/);
              done();
            });
          }, 100);
        });
    });
  });
});
