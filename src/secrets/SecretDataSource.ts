export interface SecretDataSource {
    slackToken() : Promise<string>,
    slackSigningSecret() : Promise<string>,
}

export interface SlackSecret {
    SLACK_STANDUP_SIGNING_SECRET: string
    SLACK_STANDUP_BOT_TOKEN: string
}

export type SecretKey = "SLACK_STANDUP_SIGNING_SECRET" | "SLACK_STANDUP_BOT_TOKEN";