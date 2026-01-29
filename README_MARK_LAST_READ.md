Server-side mark-last-read Cloud Function (deployment instructions)

1) Install dependencies and deploy functions:

  cd functions
  npm install
  # then back to project root
  cd ..
  firebase deploy --only functions

2) After deploy, you'll get a function URL like:
   https://<region>-<project>.cloudfunctions.net/api

3) Set environment variable in your frontend (e.g. .env.local):
   NEXT_PUBLIC_MARK_LAST_READ_URL="https://<region>-<project>.cloudfunctions.net/api/markLastRead"

4) Restart dev server. ChatWindow will call this endpoint to mark lastRead.

