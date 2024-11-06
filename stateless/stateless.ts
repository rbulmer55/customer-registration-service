import * as cdk from 'aws-cdk-lib';
import {
  JsonSchemaType,
  Model,
  RequestValidator,
  RestApi,
  StepFunctionsIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import {
  Chain,
  DefinitionBody,
  JsonPath,
  Pass,
  StateMachine,
  StateMachineType,
} from 'aws-cdk-lib/aws-stepfunctions';
import {
  DynamoAttributeValue,
  DynamoPutItem,
} from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

interface RegistrationServiceProps extends cdk.StackProps {
  customerTable: ITableV2;
}

export class RegistrationServiceStatelessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: RegistrationServiceProps) {
    super(scope, id, props);

    if (!props?.customerTable) throw Error('Missing Stateful Props.');

    const registrationWorkflow = new StateMachine(
      this,
      'RegistrationStateMachine',
      {
        stateMachineType: StateMachineType.EXPRESS,
        definitionBody: DefinitionBody.fromChainable(
          Chain.start(
            new Pass(this, 'RegisterCustomerStep', {
              stateName: 'Register Customer',
            }).next(
              new DynamoPutItem(this, 'SaveCustomerStep', {
                stateName: 'Save To DynamoDB',
                table: props.customerTable,
                item: {
                  pk: DynamoAttributeValue.fromString(
                    JsonPath.stringAt('$.body.id'),
                  ),
                  sk: DynamoAttributeValue.fromString('Customer'),
                },
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
              required: ['id'],
              properties: {
                id: { type: JsonSchemaType.STRING },
              },
            },
          }),
        },
      },
    );
  }
}
