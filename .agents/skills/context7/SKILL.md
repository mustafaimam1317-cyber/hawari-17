---
name: context7
description: >-
  Fetch version-accurate, real-time documentation, API signatures, and verified code examples using Upstash Context7.
  Use when needing official documentation or up-to-date best practices for libraries such as Supabase, PDF.js, Vite, etc.
---

# Upstash Context7 Documentation Skill

Context7 provides live, version-accurate documentation and verified code snippets for fast-moving frameworks and libraries.

## How to Query Documentation

### 1. Resolve Library Name
To search for a library ID:
```bash
npx -y ctx7 library <library-name> "<optional-query>"
```
*Example:*
```bash
npx -y ctx7 library supabase "database insert and storage upload"
```

### 2. Fetch Detailed Documentation & Examples
Once you have the library ID:
```bash
npx -y ctx7 docs <libraryId> "<query>"
```
*Example:*
```bash
npx -y ctx7 docs /supabase/supabase-js "storage upload file"
```

## Best Practices
- Use Context7 whenever integrating new third-party APIs or verifying SDK signatures to eliminate hallucinated methods.
