import * as cdk from 'aws-cdk-lib';
import { AttributeType, ITableV2, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class RegistrationServiceStatefulStack extends cdk.Stack {
  public readonly customerTable: ITableV2;
  public readonly identityVerificationBucket: IBucket;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const customersTable = new TableV2(this, 'CustomerTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
    });
    this.customerTable = customersTable;

    const identityVerificationBucket = new Bucket(
      this,
      'IdentityVerificationBucket',
      {
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
      },
    );
    this.identityVerificationBucket = identityVerificationBucket;
  }
}
