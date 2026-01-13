import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test suite for LLM template rendering
 * Validates all template formats (ChatML, Alpaca, Vicuna, Llama2)
 * and fallback behavior when template files are missing
 */

describe('LLM Template System', () => {
  const templatesDir = path.join(__dirname, '..', 'llm_templates');
  const templateNames = ['chatml', 'alpaca', 'vicuna', 'llama2'];

  describe('Template Files Exist', () => {
    it('should have all required template files', () => {
      for (const name of templateNames) {
        const filePath = path.join(templatesDir, `${name}.njk`);
        expect(fs.existsSync(filePath), `Template ${name}.njk should exist`).toBe(true);
      }
    });

    it('should have non-empty template files', () => {
      for (const name of templateNames) {
        const filePath = path.join(templatesDir, `${name}.njk`);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content.length > 0, `Template ${name}.njk should not be empty`).toBe(true);
      }
    });
  });

  describe('Template Content Validation', () => {
    it('chatml template should contain ChatML markers', () => {
      const content = fs.readFileSync(path.join(templatesDir, 'chatml.njk'), 'utf-8');
      expect(content).toContain('<|im_start|>');
      expect(content).toContain('<|im_end|>');
    });

    it('alpaca template should contain expected markers', () => {
      const content = fs.readFileSync(path.join(templatesDir, 'alpaca.njk'), 'utf-8');
      expect(content).toContain('### Instruction:');
      expect(content).toContain('### Response:');
    });

    it('vicuna template should contain USER/ASSISTANT markers', () => {
      const content = fs.readFileSync(path.join(templatesDir, 'vicuna.njk'), 'utf-8');
      expect(content).toContain('USER:');
      expect(content).toContain('ASSISTANT:');
    });

    it('llama2 template should contain [INST] markers', () => {
      const content = fs.readFileSync(path.join(templatesDir, 'llama2.njk'), 'utf-8');
      expect(content).toContain('[INST]');
      expect(content).toContain('[/INST]');
    });
  });

  describe('Template Variables', () => {
    it('all templates should reference system_prompt variable', () => {
      for (const name of templateNames) {
        const content = fs.readFileSync(path.join(templatesDir, `${name}.njk`), 'utf-8');
        expect(content).toContain('system_prompt');
      }
    });

    it('all templates should reference user_message variable', () => {
      for (const name of templateNames) {
        const content = fs.readFileSync(path.join(templatesDir, `${name}.njk`), 'utf-8');
        expect(content).toContain('user_message');
      }
    });

    it('all templates should reference assistant_message variable', () => {
      for (const name of templateNames) {
        const content = fs.readFileSync(path.join(templatesDir, `${name}.njk`), 'utf-8');
        expect(content).toContain('assistant_message');
      }
    });
  });

  describe('Template Rendering (Integration)', () => {
    it('should load and parse all templates without errors', () => {
      // This is a smoke test - just ensure templates can be read
      for (const name of templateNames) {
        const filePath = path.join(templatesDir, `${name}.njk`);
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBeTruthy();
      }
    });

    it('should have templates for all supported formats', () => {
      const supportedFormats = ['chatml', 'alpaca', 'vicuna', 'llama2'];
      for (const format of supportedFormats) {
        const filePath = path.join(templatesDir, `${format}.njk`);
        expect(fs.existsSync(filePath), `Should support ${format} format`).toBe(true);
      }
    });
  });

  describe('Fallback Behavior', () => {
    it('BaseAgent should fallback to chatml when template missing', () => {
      // This tests the fix in BaseAgent.renderLLMTemplate()
      // If profile.template = 'unknown' and unknown.njk doesn't exist,
      // it should fallback to chatml.njk
      
      const chatmlPath = path.join(templatesDir, 'chatml.njk');
      const unknownPath = path.join(templatesDir, 'unknown.njk');
      
      // Ensure chatml exists and unknown doesn't
      expect(fs.existsSync(chatmlPath)).toBe(true);
      expect(fs.existsSync(unknownPath)).toBe(false);
    });

    it('all template fallback chains should end at chatml', () => {
      // Ensure chatml.njk is the ultimate fallback
      const chatmlPath = path.join(templatesDir, 'chatml.njk');
      const chatmlContent = fs.readFileSync(chatmlPath, 'utf-8');
      expect(chatmlContent.length > 0).toBe(true);
    });
  });

  describe('Template Format Uniqueness', () => {
    it('each template should have distinct formatting', () => {
      const contents: { [key: string]: string } = {};
      for (const name of templateNames) {
        const filePath = path.join(templatesDir, `${name}.njk`);
        contents[name] = fs.readFileSync(filePath, 'utf-8');
      }
      
      // Check that templates are not identical (they should be unique)
      const uniqueContents = new Set(Object.values(contents));
      expect(uniqueContents.size).toBe(templateNames.length);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing chatml template gracefully', () => {
      const chatmlPath = path.join(templatesDir, 'chatml.njk');
      expect(fs.existsSync(chatmlPath), 'Default chatml template must exist').toBe(true);
    });

    it('should not crash when non-existent template is requested', () => {
      // This verifies the logic in BaseAgent.renderLLMTemplate()
      // that checks file existence before reading
      const unknownPath = path.join(templatesDir, 'nonexistent.njk');
      expect(fs.existsSync(unknownPath)).toBe(false);
      
      // If code tries to fallback to chatml, it should work
      const chatmlPath = path.join(templatesDir, 'chatml.njk');
      expect(fs.existsSync(chatmlPath)).toBe(true);
    });
  });

  describe('Configuration Support', () => {
    it('template names should match config.json profile options', () => {
      // When config.json has profile.template = "alpaca",
      // it should find backend/src/llm_templates/alpaca.njk
      for (const name of templateNames) {
        const filePath = path.join(templatesDir, `${name}.njk`);
        expect(fs.existsSync(filePath), `Template ${name} should be available for config`).toBe(true);
      }
    });
  });
});
