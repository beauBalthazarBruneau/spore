# Onboard

Interactive onboarding skill that walks a new user through setting up their profile and job search criteria. All writes go through the `mcp__spore__upsert_profile` tool — never write to the DB directly.

## Flow

1. **Check existing profile** — call `mcp__spore__get_profile`. If a profile already exists with populated fields, tell the user and ask if they want to update specific sections or start fresh.

2. **Basics** — ask for:
   - Full name
   - Email
   - Phone number
   - Location (city, state or "Remote")

   Write immediately via `mcp__spore__upsert_profile` after collecting these.

3. **Links** — ask for any relevant links:
   - LinkedIn URL
   - GitHub URL
   - Portfolio / personal site
   - Any other links they want to include

   Write via `mcp__spore__upsert_profile` with `links_json`.

4. **Base resume** — ask the user to paste their resume, or point you to a file to read. Convert it to clean markdown and write `base_resume_md` via `mcp__spore__upsert_profile`. If they give you a file path, read it and convert to markdown. If they paste raw text, clean it up into structured markdown with sections (Summary, Experience, Education, Skills, etc.). If the user hasn't written a resume yet, point them to `data.example/base/resume.md` as a template to fill in.

5. **Job search criteria** — this is the most important section. Ask conversationally:
   - What job titles are you targeting? (collect as array — e.g., "Software Engineer", "Data Analyst", "Designer")
   - What locations are you open to? (collect as array, include "Remote" if applicable)
   - What keywords describe your ideal role? (collect as array)
   - What's your minimum salary? (number)
   - Remote preference: "remote", "hybrid", or "onsite"?

   Remind the user that `data.example/profile.json` shows an example of filled-in criteria.

   Write via `mcp__spore__upsert_profile` with `criteria_json`.

6. **Exclusions** — ask what to filter out:
   - Any companies to exclude?
   - Industries to avoid? (e.g., crypto, gambling, defense)
   - Title keywords to skip? (e.g., "intern", "sales")
   - Description keywords to skip? (e.g., "security clearance")
   - Seniority levels to exclude? (e.g., "junior", "principal")
   - Visa sponsorship required? (boolean)

   Merge into `criteria_json.exclusions` via `mcp__spore__upsert_profile`.

7. **Preferences** — ask about general preferences:
   - Open to remote work? (boolean → `preferences_json.remote_ok`)
   - Any other preferences they want to note

   Write via `mcp__spore__upsert_profile` with `preferences_json`.

8. **Summary** — read back the full profile via `mcp__spore__get_profile` and display a clean summary. Ask if anything needs adjusting. If yes, loop back to the relevant section and update via `mcp__spore__upsert_profile`.

## Guidelines

- Be conversational, not robotic. Ask one section at a time, don't dump all questions at once.
- After each section, write to the DB immediately so progress isn't lost if the conversation is interrupted.
- Use smart defaults: if the user says "NYC" expand to "New York, NY". If they say "no crypto or gambling" turn that into `exclusions.industries: ["crypto", "gambling"]`.
- If the user provides a resume (pasted or as a file), read it to pre-fill suggestions for titles, keywords, and skills where possible.
- All DB writes MUST go through `mcp__spore__upsert_profile`. Never use the frontend API or write SQL directly.
- After onboarding, suggest the user visit the Profile page in the frontend (http://localhost:3100/profile) to review and tweak their settings, and suggest they add companies to watch with `/add-companies`.
