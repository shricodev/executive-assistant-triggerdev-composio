# Larkspur AI: company and product overview

Larkspur AI is a fictional 9-person startup based in Austin, Texas, founded in 2024.
It is used here as demo data for the executive assistant.

## What we make

**Larkspur Notes** is an API that turns recorded customer calls into structured notes.
A team uploads a recording or connects a meeting bot, and the API returns:

- a summary written for the account owner
- action items with an owner and a due date
- customer objections and feature requests, tagged by theme
- a CRM-ready JSON payload

## How customers use it

- **REST API and webhooks.** Upload audio, receive a `notes.ready` webhook, fetch the result.
- **CRM sync.** Native sync to HubSpot and Salesforce on the Team plan and above.
- **Meeting bots.** Bots for Zoom, Google Meet and Microsoft Teams.

## Product facts

- Supported languages: English, Spanish, French, German and Portuguese.
- Typical turnaround: under 3 minutes for a 60-minute call.
- Maximum recording length: 4 hours.
- Speaker identification works for up to 10 speakers per call.
- SDKs: TypeScript and Python. There is no Go or Java SDK yet.
- Not supported today: live (real-time) transcription, on-premise deployment and phone dialers.

## Security and compliance

- SOC 2 Type II report available under NDA.
- Data is encrypted in transit and at rest and stored in the United States (AWS us-east-1).
- EU data residency is on the roadmap and has no committed date.
- Customer audio is never used to train models.
- Default retention is 90 days and is configurable on the Scale plan and above.

## People

- Maya Okafor, co-founder and CEO. Owns sales conversations, pricing and partnerships.
- Daniel Reyes, co-founder and CTO. Owns security reviews and technical escalations.
- Support inbox: support@larkspur.example
