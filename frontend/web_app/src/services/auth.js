import { Auth } from 'aws-amplify';

// Sign in with username and password
export const signIn = async (username, password) => {
  try {
    const user = await Auth.signIn(username, password);
    console.log('SignIn result:', user);
    
    // Check if user needs to change password
    if (user.challengeName === 'NEW_PASSWORD_REQUIRED') {
      console.log('User needs to change password');
      return {
        type: 'FORCE_CHANGE_PASSWORD',
        user: user,
        requiredAttributes: user.challengeParam?.requiredAttributes || []
      };
    }
    
    // Normal successful login
    return {
      type: 'SUCCESS',
      user: user
    };
  } catch (error) {
    console.error('Error signing in:', error);
    throw error;
  }
};

// Sign out
export const signOut = async () => {
  try {
    await Auth.signOut();
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};

// Get current authenticated user
export const getCurrentUser = async () => {
  try {
    const user = await Auth.currentAuthenticatedUser();
    if (!user) {
      return null;
    }
    return user;
  } catch (error) {
    return null;
  }
};

// Check if user is authenticated
export const isAuthenticated = async () => {
  try {
    await Auth.currentAuthenticatedUser();
    return true;
  } catch (error) {
    return false;
  }
};

// Get JWT token
export const getJwtToken = async () => {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error) {
    console.error('Error getting JWT token:', error);
    return null;
  }
};

// Get user attributes
export const getUserAttributes = async () => {
  try {
    const user = await Auth.currentAuthenticatedUser();
    return user.attributes;
  } catch (error) {
    console.error('Error getting user attributes:', error);
    return null;
  }
};

// Change password
export const changePassword = async (oldPassword, newPassword) => {
  try {
    const user = await Auth.currentAuthenticatedUser();
    await Auth.changePassword(user, oldPassword, newPassword);
    return true;
  } catch (error) {
    console.error('Error changing password:', error);
    throw error;
  }
};

// Complete new password challenge (for FORCE_CHANGE_PASSWORD)
export const completeNewPassword = async (challengeUser, newPassword, requiredAttributes = {}) => {
  try {
    console.log('Completing new password challenge...');
    const user = await Auth.completeNewPassword(challengeUser, newPassword, requiredAttributes);
    console.log('Password change completed successfully:', user);
    return user;
  } catch (error) {
    console.error('Error completing new password:', error);
    throw error;
  }
};


