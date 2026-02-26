#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../hooks.env"

if [[ ! -f "$ENV_FILE" ]]; then
  exit 0
fi

source "$ENV_FILE"

if [[ -z "$SLACK_WEBHOOK_URL" ]]; then
  exit 0
fi

INPUT=$(cat)

HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_NAME=$(basename "$CWD")
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
SHORT_SESSION="${SESSION_ID:0:8}"
HOSTNAME=$(hostname -s 2>/dev/null || echo "unknown")

MENTION=""
if [[ -n "$SLACK_USER_ID" ]]; then
  MENTION="<@$SLACK_USER_ID>"
fi

LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // empty' | head -c 600)

case "$HOOK_EVENT" in
  "Stop")
    if [[ -n "$LAST_MSG" ]]; then
      PAYLOAD=$(jq -n \
        --arg project "$PROJECT_NAME" \
        --arg session "$SHORT_SESSION" \
        --arg host "$HOSTNAME" \
        --arg mention "$MENTION" \
        --arg summary "$LAST_MSG" \
        '{
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": ("Your task is complete.")
              }
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": $summary
              }
            },
            {
              "type": "divider"
            },
            {
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": ("Claude Code • `" + $project + "` • " + $host + " • `" + $session + "`")
                }
              ]
            }
          ]
        }')
    else
      PAYLOAD=$(jq -n \
        --arg project "$PROJECT_NAME" \
        --arg session "$SHORT_SESSION" \
        --arg host "$HOSTNAME" \
        --arg mention "$MENTION" \
        '{
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": ($mention + ", your task is complete.")
              }
            },
            {
              "type": "divider"
            },
            {
              "type": "context",
              "elements": [
                {
                  "type": "mrkdwn",
                  "text": ("Claude Code • `" + $project + "` • " + $host + " • `" + $session + "`")
                }
              ]
            }
          ]
        }')
    fi
    ;;
  "Notification")
    BODY=$(echo "$INPUT" | jq -r '.notification.body // empty' | head -c 600)
    if [[ -z "$BODY" || "$BODY" == "null" ]]; then
      BODY="${LAST_MSG:-Waiting for your response}"
    fi
    PAYLOAD=$(jq -n \
      --arg project "$PROJECT_NAME" \
      --arg session "$SHORT_SESSION" \
      --arg body "$BODY" \
      --arg host "$HOSTNAME" \
      --arg mention "$MENTION" \
      '{
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": ("Done. I need your input.")
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": $body
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": ("Claude Code • `" + $project + "` • " + $host + " • `" + $session + "`")
              }
            ]
          }
        ]
      }')
    ;;
  *)
    PAYLOAD=$(jq -n \
      --arg event "$HOOK_EVENT" \
      --arg project "$PROJECT_NAME" \
      --arg host "$HOSTNAME" \
      --arg mention "$MENTION" \
      '{
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": ($mention + ", " + $event)
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": ("Claude Code • `" + $project + "` • " + $host)
              }
            ]
          }
        ]
      }')
    ;;
esac

curl -s -X POST -H 'Content-type: application/json' -d "$PAYLOAD" "$SLACK_WEBHOOK_URL" > /dev/null 2>&1 || true

exit 0
