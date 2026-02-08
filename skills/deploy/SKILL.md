---
name: deploy
description: Deploy applications to cloud environments
---

# Deployment Instructions

When deploying applications, follow this workflow:

## Pre-Deployment Checks

1. **Verify all tests pass**
   - Run full test suite (unit, integration, e2e)
   - Check that CI/CD pipeline is green
   - Verify no linting or type errors

2. **Check environment configuration**
   - Verify all environment variables are set correctly
   - Check secrets are properly configured
   - Ensure database migrations are ready
   - Verify API endpoints and external services

3. **Review deployment plan**
   - Check which version/commit is being deployed
   - Verify the target environment (staging/production)
   - Ensure rollback plan is in place
   - Check for any breaking changes

## Deployment Process

1. **Run deployment pipeline**
   - Use the deployTool with correct environment and version
   - Monitor deployment progress
   - Watch for any errors or warnings

2. **Verify health checks after deploy**
   - Check application is responding
   - Verify key endpoints are working
   - Monitor error rates and logs
   - Confirm database connectivity

3. **Post-deployment validation**
   - Run smoke tests
   - Check monitoring dashboards
   - Verify metrics are normal
   - Confirm user-facing features work

## Rollback Procedure

If issues are detected:
1. Use rollbackTool immediately
2. Notify the team
3. Investigate root cause
4. Plan fix for next deployment

## Available Tools

- `deployTool`: Deploy to staging or production
- `rollbackTool`: Rollback to previous version if issues occur
