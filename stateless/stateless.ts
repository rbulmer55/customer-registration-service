import * as cdk from 'aws-cdk-lib';
import {
  JsonSchemaType,
  Model,
  RequestValidator,
  RestApi,
  StepFunctionsIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import {
  Chain,
  DefinitionBody,
  JsonPath,
  Pass,
  StateMachine,
  StateMachineType,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoPutItem,
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

    const registrationWorkflow = new StateMachine(
      this,
      'RegistrationStateMachine',
      {
        stateMachineType: StateMachineType.EXPRESS,
        definitionBody: DefinitionBody.fromChainable(
          Chain.start(
            new Pass(this, 'RegisterCustomerStep', {
              stateName: 'Register Customer',
            })
              .next(
                new DynamoPutItem(this, 'SaveCustomerStep', {
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
              ),
          ),
        ),
      },
    );
    props.customerTable.grantWriteData(registrationWorkflow);

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
