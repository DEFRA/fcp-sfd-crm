# fcp-sfd-crm

![Publish](https://github.com/defra/fcp-sfd-crm/actions/workflows/publish.yml/badge.svg)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fcp-sfd-crm&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_fcp-sfd-crm)

CRM orchestration service for Single Front Door.
This service is part of the [Single Front Door (SFD)](https://github.com/defra/fcp-sfd-core) service.

## Environment variables

Create a `.env` file in the root of the project based on `.env.example`.

## Local development

## Building and starting the service

This service has been configured to run in a Docker container and it is recommended to utilise Docker and Docker Compose for local development.

Build the container:

```bash
docker compose build
```

Start the container:

```bash
docker compose up
```

## Testing

Tests have also been configured to run in a Docker container.

Start the test container:

```bash
npm run docker:test
```

The test container can also be started in watch mode to support Test Driven Development (TDD):

```bash
npm run docker:test:watch
```

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of His Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
