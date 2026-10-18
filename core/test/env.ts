process.env.MONGO_URI = "mongodb://unit-tests-use-memory-server.invalid";
process.env.QUEUE_PREFIX = "helios-test";
process.env.LAMBDA_MAX_DURATION_SEC = "180";
process.env.LAMBDA_MAX_SOURCE_BYTES = "524288000";
process.env.LOG_LEVEL = "fatal";
process.env.AWS_REGION = "us-east-2";
process.env.SQS_FAIR_QUEUES = "true";
