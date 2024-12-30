# Customer; Registration Service

In this project we use direct integration between AWS services to orchestrate a new customer registration.

By using Orchestration we can involve other services and teams into the customer on-boarding journey.

In this example we show how a customer can be added to rewards, validated by an accounts department and saved to a customer database all through StepFunction Express Workflows.

## Architecture

![architecture of registration service](./docs/registrationService.png 'Registration service')

## More detail

More detail on this project can be found in my post here: [https://blog.architechinsights.com/onboarding-customers-via-multi-step-workflows-in-the-aws-cdk-bca1931e8da5](https://blog.architechinsights.com/onboarding-customers-via-multi-step-workflows-in-the-aws-cdk-bca1931e8da5)

![architecture of registration service post](./docs/post_banner.webp 'Registration service post')

### Useful commands

This app is built using the AWS CDK.

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
