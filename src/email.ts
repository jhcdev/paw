export const EMAIL_REGEX =
  /^(?!.*\.\.)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (email.length === 0) {
    return false;
  }

  if (email !== email.trim()) {
    return false;
  }

  if (email.length > 254) {
    return false;
  }

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return false;
  }

  const localPart = email.slice(0, atIndex);
  if (localPart.length === 0 || localPart.length > 64) {
    return false;
  }

  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return false;
  }

  return EMAIL_REGEX.test(email);
}
