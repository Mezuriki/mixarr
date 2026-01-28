import { test, expect, TEST_USER } from './fixtures';

/**
 * Authentication E2E Tests
 * 
 * Tests login, logout, and session management flows
 */

test.describe('Authentication', () => {
  test.describe('Login Flow', () => {
    test('can login with valid credentials', async ({ page }) => {
      await page.goto('/login');
      
      // Fill form
      await page.getByLabel(/email/i).fill(TEST_USER.email);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      
      // Submit
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      
      // Should redirect to dashboard or home
      await expect(page).toHaveURL(/\/(dashboard|subscriptions)?$/);
      
      // Should show authenticated state (user menu, logout button, etc.)
      await expect(
        page.getByRole('button', { name: /account|user|logout|sign out/i }).or(
          page.getByText(TEST_USER.email)
        )
      ).toBeVisible();
    });

    test('shows error for invalid credentials', async ({ page }) => {
      await page.goto('/login');
      
      // Fill with invalid credentials
      await page.getByLabel(/email/i).fill('wrong@example.com');
      await page.getByLabel(/password/i).fill('wrongpassword');
      
      // Submit
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      
      // Should show error message
      await expect(
        page.getByText(/invalid|incorrect|failed|error/i)
      ).toBeVisible();
      
      // Should stay on login page
      await expect(page).toHaveURL(/\/login/);
    });

    test('shows validation errors for empty fields', async ({ page }) => {
      await page.goto('/login');
      
      // Submit without filling fields
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      
      // Should show validation errors or HTML5 validation
      const emailInput = page.getByLabel(/email/i);
      const passwordInput = page.getByLabel(/password/i);
      
      // Check for either custom validation message or HTML5 required state
      const hasEmailError = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
      const hasPasswordError = await passwordInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
      
      expect(hasEmailError || hasPasswordError).toBe(true);
    });
  });

  test.describe('Session Management', () => {
    test('can logout successfully', async ({ authenticatedPage }) => {
      // Find and click logout button
      const logoutButton = authenticatedPage.getByRole('button', { name: /logout|sign out/i })
        .or(authenticatedPage.getByRole('link', { name: /logout|sign out/i }));
      
      await logoutButton.click();
      
      // Should redirect to login page
      await expect(authenticatedPage).toHaveURL(/\/login/);
    });

    test('session persists across page reload', async ({ authenticatedPage }) => {
      // Reload the page
      await authenticatedPage.reload();
      
      // Should still be authenticated (not redirected to login)
      await expect(authenticatedPage).not.toHaveURL(/\/login/);
      
      // Should still show authenticated state
      await expect(
        authenticatedPage.getByRole('button', { name: /account|user|logout|sign out/i }).or(
          authenticatedPage.getByText(TEST_USER.email)
        )
      ).toBeVisible();
    });
  });

  test.describe('Protected Routes', () => {
    test('redirects to login when accessing protected route unauthenticated', async ({ page }) => {
      // Try to access a protected route directly
      await page.goto('/subscriptions');
      
      // Should be redirected to login
      await expect(page).toHaveURL(/\/login/);
    });
  });
});
