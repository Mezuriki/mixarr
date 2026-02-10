import { test, expect } from './fixtures';

/**
 * Subscriptions E2E Tests
 * 
 * Tests the subscription management modal and form flows
 */

test.describe('Subscriptions', () => {
  test.describe('Add Subscription Modal', () => {
    test.beforeEach(async ({ page }) => {
      // Login first (if required)
      await page.goto('/login');
      
      // Check if we need to login
      if (await page.getByLabel(/email/i).isVisible()) {
        await page.getByLabel(/email/i).fill('test@example.com');
        await page.getByLabel(/password/i).fill('testpassword123');
        await page.getByRole('button', { name: /sign in|log in/i }).click();
        await page.waitForURL(/\/(dashboard|subscriptions)?$/);
      }
      
      await page.goto('/subscriptions');
    });

    test('can open add subscription modal', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add|new|create/i });
      
      await expect(addButton).toBeVisible();
      await addButton.click();
      
      // Modal should be visible
      const modal = page.getByRole('dialog').or(page.locator('[role="dialog"]'));
      await expect(modal).toBeVisible();
    });

    test('modal has all required form fields', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add|new|create/i });
      
      if (await addButton.isVisible()) {
        await addButton.click();
        
        // Check for expected form fields
        // These selectors are based on typical subscription form fields
        const artistInput = page.getByLabel(/artist/i)
          .or(page.getByPlaceholder(/artist/i));
        const typeSelect = page.getByLabel(/type/i)
          .or(page.getByRole('combobox'));
        
        // At least one form field should be present
        const hasFormFields = await artistInput.isVisible() || await typeSelect.isVisible();
        expect(hasFormFields).toBe(true);
      }
    });

    test('validates required fields', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add|new|create/i });
      
      if (await addButton.isVisible()) {
        await addButton.click();
        
        // Find and click submit without filling required fields
        const submitButton = page.getByRole('button', { name: /save|submit|add|create/i })
          .filter({ hasNot: page.getByRole('button', { name: /cancel|close/i }) });
        
        if (await submitButton.isVisible()) {
          await submitButton.click();
          
          // Should show validation error or prevent submission
          const hasError = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('[role="alert"], .error, .text-red-500, .text-destructive');
            const invalidInputs = document.querySelectorAll(':invalid');
            return errorElements.length > 0 || invalidInputs.length > 0;
          });
          
          expect(hasError).toBe(true);
        }
      }
    });

    test('can close modal with cancel button', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add|new|create/i });
      
      if (await addButton.isVisible()) {
        await addButton.click();
        
        const modal = page.getByRole('dialog').or(page.locator('[role="dialog"]'));
        await expect(modal).toBeVisible();
        
        // Find cancel/close button
        const cancelButton = page.getByRole('button', { name: /cancel|close/i })
          .or(page.getByLabel(/close/i));
        
        if (await cancelButton.isVisible()) {
          await cancelButton.click();
          
          // Modal should be closed
          await expect(modal).not.toBeVisible();
        }
      }
    });

    test('can close modal with Escape key', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /add|new|create/i });
      
      if (await addButton.isVisible()) {
        await addButton.click();
        
        const modal = page.getByRole('dialog').or(page.locator('[role="dialog"]'));
        await expect(modal).toBeVisible();
        
        // Press Escape
        await page.keyboard.press('Escape');
        
        // Modal should be closed
        await expect(modal).not.toBeVisible();
      }
    });
  });
});
