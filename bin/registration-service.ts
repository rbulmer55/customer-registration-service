#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

// import { RegistrationServiceStatefulStack } from '../stateful/stateful';
import { RegistrationServiceStatelessStack } from '../stateless/stateless';
import { RegistrationServiceStatefulStack } from '../stateful/stateful';

const app = new cdk.App();

const registrationStateful = new RegistrationServiceStatefulStack(
  app,
  'RegistrationServiceStatefulStack',
  {},
);

new RegistrationServiceStatelessStack(
  app,
  'RegistrationServiceStatelessStack',
  {
    customerTable: registrationStateful.customerTable,
  },
);
