---
name: code-review
description: Review code for quality and security
---

# Code Review Instructions

When reviewing code, you should:

1. **Check for security vulnerabilities**
   - Look for SQL injection risks
   - Check for XSS vulnerabilities
   - Verify input validation
   - Review authentication and authorization

2. **Verify error handling**
   - Ensure errors are caught and handled appropriately
   - Check that error messages don't leak sensitive information
   - Verify proper logging of errors

3. **Assess code clarity**
   - Check for clear variable and function names
   - Verify adequate comments for complex logic
   - Look for overly complex functions that should be broken down
   - Ensure consistent code style

4. **Suggest improvements**
   - Identify opportunities for refactoring
   - Point out performance issues
   - Recommend better patterns or practices
   - Highlight areas that need tests

5. **Review tests**
   - Check that new code has appropriate test coverage
   - Verify tests are meaningful and not just for coverage
   - Look for edge cases that should be tested

## Output Format

Provide your review as:
- **Summary**: Brief overview of the changes
- **Security Issues**: Any security concerns found
- **Code Quality**: Comments on code quality and style
- **Suggestions**: Concrete improvement suggestions
- **Approval**: Whether the code is ready to merge or needs changes
