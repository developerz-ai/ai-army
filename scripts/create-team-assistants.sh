#!/usr/bin/env bash
#
# Create AI Assistants for Team Members
#
# Usage:
#   ./scripts/create-team-assistants.sh "John Doe" "jane-smith" "Alex Chen"
#
# This script:
# 1. Creates a bot for each team member
# 2. Generates unique API keys
# 3. Updates config.json and .env
# 4. Creates setup instructions for each person

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BOTS_DIR="$PROJECT_DIR/bots"
SETUP_DIR="$PROJECT_DIR/team-setups"

# Create setup directory
mkdir -p "$SETUP_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🤖 AI Army - Team Assistant Generator${NC}"
echo ""

# Check if team members provided
if [ $# -eq 0 ]; then
  echo "Usage: $0 \"Team Member 1\" \"Team Member 2\" ..."
  echo ""
  echo "Example:"
  echo "  $0 \"John Doe\" \"Jane Smith\" \"Alex Chen\""
  exit 1
fi

# Store all generated data
declare -a TEAM_MEMBERS=("$@")
declare -A API_KEYS
declare -A BOT_IDS

# Function to generate bot ID from name
generate_bot_id() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g'
}

# Function to generate API key
generate_api_key() {
  local prefix="$1"
  echo "${prefix}-$(openssl rand -hex 16)"
}

echo -e "${YELLOW}Creating assistants for ${#TEAM_MEMBERS[@]} team member(s)...${NC}"
echo ""

# Process each team member
for member_name in "${TEAM_MEMBERS[@]}"; do
  bot_id="$(generate_bot_id "$member_name")-assistant"
  api_key=$(generate_api_key "tm")

  # Store for later use
  API_KEYS["$member_name"]="$api_key"
  BOT_IDS["$member_name"]="$bot_id"

  echo -e "${GREEN}👤 $member_name${NC}"
  echo "   Bot ID: $bot_id"
  echo "   API Key: $api_key"

  # Create bot directory
  bot_dir="$BOTS_DIR/$bot_id"
  mkdir -p "$bot_dir"

  # Create bot config.json
  cat > "$bot_dir/config.json" << EOF
{
  "id": "$bot_id",
  "name": "$member_name's AI Assistant",
  "description": "Personal AI assistant for $member_name with full development capabilities",
  "soul": "./soul.md",
  "provider": "openrouter",
  "model": "openrouter/aurora-alpha",
  "tools": [
    "bash",
    "readFile",
    "writeFile",
    "glob",
    "grep"
  ],
  "mcpServers": ["filesystem"],
  "maxSteps": 50,
  "temperature": 0.7
}
EOF

  # Create bot soul.md
  cat > "$bot_dir/soul.md" << EOF
# $member_name's Personal AI Assistant

You are a highly capable AI assistant created for **$member_name**. You have full access to bash commands, filesystem operations, and development tools.

## Your Role

You are $member_name's trusted assistant for:
- **Development** - Write code, debug, run tests
- **System tasks** - File management, scripts, monitoring
- **Data processing** - Analyze logs, generate reports
- **Automation** - Execute multi-step workflows
- **Research** - Search code, read documentation

## Guidelines

1. Be proactive and suggest improvements
2. Always verify your work by checking outputs
3. Don't execute dangerous commands without asking
4. Be efficient and use the best approach
5. Explain what you're doing

## Tools Available

- bash, readFile, writeFile, glob, grep
- Filesystem MCP (14 additional tools)

## Environment

You operate in an isolated Docker container at \`/home/agent\`.
You can create files, run scripts, install packages, and execute any development task.

Always provide clear, actionable responses with command outputs.
EOF

  echo "   ✅ Bot created at: $bot_dir"
  echo ""
done

# Generate config.json API auth section
echo -e "${YELLOW}Generating API configuration...${NC}"
echo ""

cat > "$SETUP_DIR/api-tokens-config.json" << 'EOF'
{
  "api": {
    "auth": {
      "tokens": [
EOF

# Add admin token
echo '        {' >> "$SETUP_DIR/api-tokens-config.json"
echo '          "token": "${ADMIN_API_KEY}",' >> "$SETUP_DIR/api-tokens-config.json"
echo '          "role": "admin",' >> "$SETUP_DIR/api-tokens-config.json"
echo '          "name": "admin",' >> "$SETUP_DIR/api-tokens-config.json"
echo '          "bots": null' >> "$SETUP_DIR/api-tokens-config.json"
echo '        },' >> "$SETUP_DIR/api-tokens-config.json"

# Add team member tokens
for member_name in "${TEAM_MEMBERS[@]}"; do
  bot_id="${BOT_IDS[$member_name]}"
  env_var_name="$(echo "$member_name" | tr '[:lower:] ' '[:upper:]_')_API_KEY"

  cat >> "$SETUP_DIR/api-tokens-config.json" << EOF
        {
          "token": "\${${env_var_name}}",
          "role": "operator",
          "name": "$member_name",
          "bots": ["$bot_id"]
        },
EOF
done

# Remove trailing comma and close JSON
sed -i '$ s/,$//' "$SETUP_DIR/api-tokens-config.json"
cat >> "$SETUP_DIR/api-tokens-config.json" << 'EOF'
      ]
    }
  }
}
EOF

echo "✅ API config generated: $SETUP_DIR/api-tokens-config.json"
echo ""

# Generate .env entries
echo -e "${YELLOW}Generating environment variables...${NC}"
echo ""

cat > "$SETUP_DIR/env-additions.txt" << 'EOF'
# Team API Keys
ADMIN_API_KEY=admin-1df48fb297db606ca1646086f89495bd7b8aaff202e1b4f3
EOF

for member_name in "${TEAM_MEMBERS[@]}"; do
  api_key="${API_KEYS[$member_name]}"
  env_var_name="$(echo "$member_name" | tr '[:lower:] ' '[:upper:]_')_API_KEY"
  echo "${env_var_name}=${api_key}" >> "$SETUP_DIR/env-additions.txt"
done

echo "✅ Environment variables: $SETUP_DIR/env-additions.txt"
echo ""

# Generate individual setup files for each team member
echo -e "${YELLOW}Creating personalized setup instructions...${NC}"
echo ""

for member_name in "${TEAM_MEMBERS[@]}"; do
  bot_id="${BOT_IDS[$member_name]}"
  api_key="${API_KEYS[$member_name]}"

  setup_file="$SETUP_DIR/SETUP-$(echo "$member_name" | tr ' ' '-').txt"

  cat > "$setup_file" << EOF
=================================================================
  ${member_name^^} - AI ASSISTANT SETUP
=================================================================

Hi $member_name! 👋

Your personal AI assistant is ready on the team's AI Army server.

📋 SETUP - Copy this into your terminal:
-----------------------------------------------------------------

cat >> ~/.claude/config.json << 'CLAUDE_EOF'
{
  "mcpServers": {
    "my-assistant": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/home/debian/workspace/developerz-ai/ai-army/mcp-servers/daniel-assistant/index.js"
      ],
      "env": {
        "AI_ARMY_URL": "http://15.204.245.151:3000",
        "API_KEY": "$api_key"
      }
    }
  }
}
CLAUDE_EOF

-----------------------------------------------------------------

✅ THEN: Restart Claude Code (type 'exit' then start again)

🎯 HOW TO USE:

In Claude Code, just type:

> Use ask_assistant to: "Show me all files"
> Use ask_assistant to: "Create a Python script"
> Use ask_assistant to: "Run system diagnostics"

=================================================================

🔑 YOUR CREDENTIALS (KEEP SECRET!)
-----------------------------------------------------------------
API Key: $api_key
Bot ID: $bot_id
Server: http://15.204.245.151:3000
-----------------------------------------------------------------

✨ YOUR ASSISTANT CAN:
• Execute bash commands
• Read and write files
• Search through code
• Run scripts and tests
• Process data
• Generate code
• Analyze logs

All in an isolated, secure Docker container!

=================================================================

🆘 NEED HELP?
Contact your admin or check: http://15.204.245.151:3000/health

🎉 Happy coding!
=================================================================
EOF

  echo "   ✅ Setup file: $setup_file"
done

echo ""
echo -e "${GREEN}✅ All assistants created!${NC}"
echo ""
echo -e "${YELLOW}📋 NEXT STEPS FOR ADMIN:${NC}"
echo ""
echo "1. Update production config.json with the auth section from:"
echo "   $SETUP_DIR/api-tokens-config.json"
echo ""
echo "2. Add environment variables from:"
echo "   $SETUP_DIR/env-additions.txt"
echo "   to production .env file"
echo ""
echo "3. Deploy to production:"
echo "   ./scripts/deploy-to-prod.sh --full"
echo ""
echo "4. Share setup files with team:"
for member_name in "${TEAM_MEMBERS[@]}"; do
  setup_file="SETUP-$(echo "$member_name" | tr ' ' '-').txt"
  echo "   - $member_name: team-setups/$setup_file"
done
echo ""
echo -e "${GREEN}🎉 Team assistants ready to deploy!${NC}"
