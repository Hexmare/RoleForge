# Character Improvements Plan

This plan outlines the steps to overhaul the character and persona systems in RoleForge, adopting a richer interface, separate storage, and AI-assisted creation.

## Phase 1: Define New Schemas and Interfaces
- [x] Update Character_Schema.json to match the SuggestedCharacterInterface.md, adding avatarUrl.
- [x] Create Persona_Schema.json based on the same interface (adapted for users).
- [x] Update TypeScript interfaces in frontend and backend to use the new structure.
- [ ] Ensure backward compatibility with existing chara_card_v2 imports.

## Phase 2: Separate Character Database
- [x] Create a new SQLite database file for characters (e.g., characters.db).
- [x] Design tables: Characters (with full new schema), CharacterOverrides (linked to worlds/campaigns).
- [x] Migrate existing characters from world databases to the new characters.db.
- [x] Update CharacterService.ts to use the new database.
- [x] Keep overrides in world/campaign databases as before.

## Phase 3: Implement CreatorAgent
- [x] Create CreatorAgent.ts in backend/src/agents/, extending BaseAgent.
- [x] Define prompt in prompts/creator.njk for generating character data from card + user directions.
- [x] Output JSON matching the new interface.
- [x] Integrate with Orchestrator for background processing.

## Phase 4: Update Import Process
- [x] Modify character import in CharacterManager.tsx to: import card -> show input for directions -> call CreatorAgent -> save generated character.
- [x] Add UI for user directions input (optional text box).
- [x] Handle CreatorAgent response: parse JSON, validate, save to characters.db.
- [x] Add error handling for invalid generations.

## Phase 5: Update Persona System
- [x] Update PersonaManager.tsx and related components to use the new interface.
- [x] Add fields for appearance, personality, etc., in the UI.
- [x] Implement CreatorAgent for persona creation (similar to characters).
- [x] Update persona CRUD to match new schema.

## Phase 6: Update CRUD Operations
- [x] Update backend routes for characters: create, read, update, delete using new schema.
- [x] Update frontend CharacterManager.tsx for new fields.
- [x] Update persona CRUD routes and UI.
- [x] Ensure avatarUrl upload/storage works with new structure.

## Phase 7: Update Prompts and Agents
- [x] Update world.njk, character.njk, etc., to reference new character/persona fields.
- [x] Ensure WorldAgent can track user states using expanded persona data.
- [x] Update any agent prompts that reference character data.

## Phase 8: Refining of Persona and Character Manager Interface
- [x] Update CharacterManager.tsx and PersonaManager.tsx to show a list view by default: Display Name, Description, Avatar (or placeholder), with Edit, Delete, Copy buttons.
- [x] Implement Copy functionality: On Copy click, show dialog for new name, then duplicate the character/persona with the new name.
- [x] Add "Generate Character/Persona" button at the top: Opens dialog with Name, Description, Instructions fields, Run/Cancel buttons. On Run, call CreatorAgent with inputs to generate new entry.
- [x] Refactor edit form: Use Labels and short descriptions for each attribute instead of default text labeling.
- [x] Add per-field update buttons: For each attribute in the edit form, include a button to regenerate that specific field using CreatorAgent (with instructions dialog).
- [x] Implement switchable prompts in CreatorAgent: Add logic to select appropriate prompt based on operation (full creation, field update, full regeneration).
- [x] Add "Regenerate All" button at top of edit form: On click, show checkboxes next to each attribute (with Check All/Uncheck All buttons), Proceed/Cancel.
- [x] On Proceed for Regenerate All: Show instructions dialog with Run/Cancel. On Run, pass existing character/persona and instructions to CreatorAgent for selective/full update.
- [x] Ensure CreatorAgent handles partial updates: Modify CreatorAgent to accept existing data and only update selected fields based on instructions.
- [x] Update backend routes if needed for new CreatorAgent operations (e.g., field-specific regeneration).
- [x] Test UI interactions: List view, dialogs, form layouts, and CreatorAgent integrations.

## Phase 9: Testing and Integration
- [ ] Test character import with CreatorAgent.
- [ ] Test persona creation and updates.
- [ ] Verify world overrides still work.
- [ ] Run full integration tests with chat and state tracking.
- [ ] Update documentation and examples.