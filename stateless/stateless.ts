import * as cdk from 'aws-cdk-lib';
import {
  JsonSchemaType,
  Model,
  RequestValidator,
  RestApi,
  StepFunctionsIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import {
  Chain,
  DefinitionBody,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoPutItem,
  EventBridgePutEvents,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

interface RegistrationServiceProps extends cdk.StackProps {
  customerTable: ITableV2;
  registrationBucket: IBucket;
}

export class RegistrationServiceStatelessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RegistrationServiceProps) {
    super(scope, id, props);

    if (!props.customerTable || !props.registrationBucket)
      throw Error('Missing Stateful Props.');

    /**
     * Create the SQS queue where events will be sent
     * NOTE: Illustration only, should exist in the REWARDS service
     */
    const rewardsDlq = new Queue(this, 'rewardsDLQ', {});
    const rewardsQueue = new Queue(this, 'rewardsQueue', {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: rewardsDlq,
      },
    });
    // Grant permissions for EventBridge to send messages to the SQS queue
    rewardsQueue.grantSendMessages(
      new ServicePrincipal('events.amazonaws.com'),
    );

    /**
     * Company Event Bus
     * NOTE: This should be in an isolated stack and consumed by each team
     * Then events routed to a local service bus.
     * Single Bus, Multi-account pattern
     * https://github.com/aws-samples/amazon-eventbridge-resource-policy-samples/blob/main/patterns/single-bus-multi-account-pattern/README.md
     */
    const companyEventBus = new EventBus(this, 'CompanyBus', {
      eventBusName: 'RBESignEventBus',
      description: 'RBESignEventBus for all company events',
    });

    /**
     * Rewards local bus
     * accepts events from central company bus
     * NOTE: Illustration only, should exist in the REWARDS service
     */
    const rewardsLocalBus = new EventBus(this, 'RewardsBus', {
      eventBusName: 'RewardsBus',
      description: 'RewardsBus for reward related events',
    });
    // Grant permissions to allow the rule to send events to rewardsLocalBus
    rewardsLocalBus.grantPutEventsTo(
      new ServicePrincipal('events.amazonaws.com'),
    );

    /**
     * Create a rule to listen to events on our companyBus
     * NOTE: Illustration only, should exist in the REWARDS service
     * Forward to the local rewards bus
     */
    new Rule(this, 'ForwardRegistrationEvents', {
      eventBus: companyEventBus, // Listen on companyBus
      eventPattern: {
        source: ['CustomerCreated'], // Match events from 'CustomerCreated'
        detailType: ['Customer.RegistrationService'], // Match events with 'Customer.RegistrationService' in detailType
      },
      targets: [
        new cdk.aws_events_targets.EventBus(rewardsLocalBus), // Forward matching events to rewards bus
      ],
    });

    /**
     * Create a rule to forward registrion events to our reward queue
     * NOTE: Illustration only, should exist in the REWARDS service
     */
    new Rule(this, 'ForwardRegistrationEventsToSQS', {
      eventBus: rewardsLocalBus, // Listen to rewards bus
      eventPattern: {
        source: ['CustomerCreated'], // Match events from 'CustomerCreated'
        detailType: ['Customer.RegistrationService'], // Match events with 'Customer.RegistrationService' in detailType
      },
      targets: [
        new cdk.aws_events_targets.SqsQueue(rewardsQueue), // Forward matching events to the SQS queue
      ],
    });

    const logGroup = new LogGroup(this, 'RegistrationWorkflowLogGroup');
    const registrationWorkflow = new StateMachine(
      this,
      'RegistrationStateMachine',
      {
        stateMachineType: StateMachineType.EXPRESS,
        logs: {
          destination: logGroup,
          // log payloads for retries
          includeExecutionData: true,
          // Log only errors to help with security
          level: LogLevel.ALL,
        },
        definitionBody: DefinitionBody.fromChainable(
          Chain.start(
            new Pass(this, 'RegisterCustomerStep', {
              stateName: 'Register Customer',
            })
              .next(
                new DynamoPutItem(this, 'SaveCustomerStep', {
                  // Set the resultPath to null to pass original input
                  resultPath: JsonPath.DISCARD,
                  stateName: 'Save To DynamoDB',
                  table: props.customerTable,
                  item: {
                    pk: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$.body.id'),
                    ),
                    sk: DynamoAttributeValue.fromString('Customer'),
                    id: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$.body.id'),
                    ),
                    name: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$.body.name'),
                    ),
                    companyIdentificationNumber:
                      DynamoAttributeValue.fromString(
                        JsonPath.stringAt('$.body.companyIdentificationNumber'),
                      ),
                    companyIdentificationType: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$.body.companyIdentificationType'),
                    ),
                    companyPostalCode: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$.body.companyPostalCode'),
                    ),
                    createdAt: DynamoAttributeValue.fromString(
                      JsonPath.stringAt('$$.State.EnteredTime'),
                    ),
                  },
                }),
              )
              .next(
                new CallAwsService(this, 'callS3Service', {
                  // Set the resultPath to null to pass original input
                  resultPath: JsonPath.DISCARD,
                  service: 's3',
                  action: 'putObject',
                  parameters: {
                    Bucket: props.registrationBucket.bucketName,
                    Key: JsonPath.stringAt('$$.State.EnteredTime'),
                    Body: JsonPath.stringAt('$.body'),
                  },
                  iamResources: [
                    `arn:aws:s3:::${props.registrationBucket.bucketName}/*`,
                  ],
                }),
              )
              .next(
                new EventBridgePutEvents(this, 'raiseNewCustomerEvent', {
                  // Set the resultPath to null to pass original input
                  resultPath: JsonPath.DISCARD,
                  entries: [
                    {
                      detail: TaskInput.fromObject({
                        metadata: {
                          // create a correlation id
                          correlationId: JsonPath.uuid(),
                          // Execution Id
                          causationId: JsonPath.stringAt('$$.Execution.Name'),
                          // Timestamp entered state
                          timestamp: JsonPath.stringAt('$$.State.EnteredTime'),
                        },
                        data: JsonPath.stringAt('$.body'),
                      }),
                      eventBus: companyEventBus,
                      detailType: 'Customer.RegistrationService',
                      source: 'CustomerCreated',
                    },
                  ],
                }),
              ),
          ),
        ),
      },
    );
    props.customerTable.grantWriteData(registrationWorkflow);
    companyEventBus.grantPutEventsTo(registrationWorkflow);

    const registrationApi = new RestApi(this, 'RegistrationAPI', {});
    const v1 = registrationApi.root.addResource('v1');
    const v1Customers = v1.addResource('customers');

    const v1CustomerCreate = v1Customers.addMethod(
      'POST',
      StepFunctionsIntegration.startExecution(registrationWorkflow),
      {
        requestValidator: new RequestValidator(this, 'PostCustomerValidator', {
          restApi: registrationApi,
          requestValidatorName: 'postCustomerValidator',
          validateRequestBody: true,
        }),
        requestModels: {
          'application/json': new Model(this, 'CustomerValidator', {
            restApi: registrationApi,
            contentType: 'application/json',
            description: 'Validating customer request body',
            modelName: 'customerModelCDK',
            schema: {
              type: JsonSchemaType.OBJECT,
              required: [
                'id',
                'name',
                'companyIdentificationNumber',
                'companyIdentificationType',
                'companyPostalCode',
              ],
              properties: {
                id: { type: JsonSchemaType.STRING },
                name: { type: JsonSchemaType.STRING },
                companyIdentificationNumber: {
                  type: JsonSchemaType.STRING,
                },
                companyIdentificationType: { type: JsonSchemaType.STRING },
                companyPostalCode: {
                  type: JsonSchemaType.STRING,
                },
              },
            },
          }),
        },
      },
    );
  }
}
