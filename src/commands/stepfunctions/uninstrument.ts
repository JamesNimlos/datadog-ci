import {CloudWatchLogsClient, DescribeSubscriptionFiltersCommandOutput} from '@aws-sdk/client-cloudwatch-logs'
import {SFNClient} from '@aws-sdk/client-sfn'
import {Command} from 'clipanion'

import {deleteSubscriptionFilter, describeStateMachine, describeSubscriptionFilters, untagResource} from './awsCommands'
import {DD_CI_IDENTIFING_STRING, TAG_VERSION_NAME} from './constants'
import {getStepFunctionLogGroupArn, isValidArn, parseArn} from './helpers'

export class UninstrumentStepFunctionsCommand extends Command {
  public static usage = Command.Usage({
    description: 'Remove Step Functions log groups subscription filter created by Datadog-CI',
    details: '--stepfunction expects a Step Function ARN',
    examples: [
      [
        'View and apply changes to remove Step Functions log groups subscription filters created by Datadog-CI',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ],
      [
        'View changes to remove Step Functions log groups subscription filters created by Datadog-CI',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction --dry-run',
      ],
      [
        'View and apply changes to remove Step Functions log groups subscription filters created by Datadog-CI',
        'datadog-ci stepfunctions uninstrument --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1 --step-function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2',
      ],
    ],
  })

  private dryRun = false
  private stepFunctionArns: string[] = []

  public async execute() {
    let validationError = false

    // remove duplicate step function arns
    const stepFunctionArns = [...new Set(this.stepFunctionArns)]

    if (stepFunctionArns.length === 0) {
      this.context.stdout.write(`[Error] must specify at least one --step-function\n`)
      validationError = true
    }

    for (const stepFunctionArn of stepFunctionArns) {
      if (!isValidArn(stepFunctionArn)) {
        this.context.stdout.write(`[Error] invalid arn format for --step-function ${stepFunctionArn}\n`)
        validationError = true
      }
    }

    if (validationError) {
      return 1
    }

    this.context.stdout.write(`\n${'1'.repeat(22)}`)
    this.context.stdout.write(`\n stepFunctionArns: ${stepFunctionArns}`)

    // loop over step functions passed as parameters and generate a list of requests to make to AWS for each step function
    for (const stepFunctionArn of stepFunctionArns) {
      // use region from the step function arn to make requests to AWS
      const arnObject = parseArn(stepFunctionArn)
      const region = arnObject.region
      const cloudWatchLogsClient = new CloudWatchLogsClient({region})
      const stepFunctionsClient = new SFNClient({region})

      let describeStateMachineCommandOutput
      try {
        describeStateMachineCommandOutput = await describeStateMachine(stepFunctionsClient, stepFunctionArn)
        this.context.stdout.write(`\n ${JSON.stringify(describeStateMachineCommandOutput)}`)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(`\n[Error] ${err.message}. Unable to fetch Step Function ${stepFunctionArn}\n`)
        } else {
          this.context.stdout.write(`\n[Error] ${err}. Unable to fetch Step Function ${stepFunctionArn}\n`)
        }

        return 1
      }

      const logGroupArn = getStepFunctionLogGroupArn(describeStateMachineCommandOutput)
      if (logGroupArn === undefined) {
        this.context.stdout.write('\n[Error] Unable to get Log Group arn from Step Function logging configuration\n')

        return 1
      }
      const logGroupName = parseArn(logGroupArn).resourceName

      // delete subscription filters that are created by Datadog-CI
      let describeSubscriptionFiltersResponse: DescribeSubscriptionFiltersCommandOutput | undefined
      try {
        describeSubscriptionFiltersResponse = await describeSubscriptionFilters(cloudWatchLogsClient, logGroupName)
        this.context.stdout.write(`\n${'4'.repeat(22)}`)
        this.context.stdout.write(`\n describeSubscriptionFiltersResponse: ${JSON.stringify(describeSubscriptionFiltersResponse)}`)
      } catch (err) {
        if (err instanceof Error) {
          this.context.stdout.write(
            `\n[Error] ${err.message}. Unable to fetch Subscription Filter to delete for Log Group ${logGroupName}\n`
          )
        } else {
          this.context.stdout.write(
            `\n[Error] ${err}. Unable to fetch Subscription Filter to delete for Log Group ${logGroupName}\n`
          )
        }

        return 1
      }
      const subscriptionFilters =
        describeSubscriptionFiltersResponse.subscriptionFilters?.filter((subscriptionFilter) =>
          subscriptionFilter.filterName?.includes(DD_CI_IDENTIFING_STRING)
        ) ?? []
      this.context.stdout.write(`\n${'5'.repeat(22)}`)
      this.context.stdout.write(`\n subscriptionFilters: ${JSON.stringify(subscriptionFilters)}`)

      for (const subscriptionFilter of subscriptionFilters) {
        if (typeof subscriptionFilter.filterName === 'string') {
          void deleteSubscriptionFilter(
            cloudWatchLogsClient,
            subscriptionFilter.filterName,
            logGroupName,
            stepFunctionArn,
            this.context,
            this.dryRun
          )
        }
      }

      const tagKeystoRemove: string[] = [TAG_VERSION_NAME]
      // Untag resource command is idempotent, no need to verify if the tag exist by making an additional api call to get tags
      void untagResource(stepFunctionsClient, tagKeystoRemove, stepFunctionArn, this.context, this.dryRun)
    }

    return 0
  }
}

UninstrumentStepFunctionsCommand.addPath('stepfunctions', 'uninstrument')

UninstrumentStepFunctionsCommand.addOption('dryRun', Command.Boolean('-d,--dry-run'))
UninstrumentStepFunctionsCommand.addOption('stepFunctionArns', Command.Array('-s,--step-function'))
