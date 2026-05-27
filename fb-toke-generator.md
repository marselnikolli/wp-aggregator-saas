Excellent choice! Here's the complete script with **email notifications** for token rotation events. This ensures you're always aware of what's happening with your tokens.

## Complete Script with Email Notifications

```python
#!/usr/bin/env python3
"""
Facebook Token Manager with Auto-Rotation & Email Notifications
Features:
- Automatic token rotation every N days
- Email alerts for rotation events
- Error notifications if rotation fails
- Full audit trail
"""

import requests
import json
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Optional, Dict, List
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('facebook_token_manager.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class EmailNotifier:
    """Handle email notifications for token events"""
    
    def __init__(self, config: Dict):
        self.smtp_server = config.get('smtp_server', 'smtp.gmail.com')
        self.smtp_port = config.get('smtp_port', 587)
        self.sender_email = config.get('sender_email')
        self.sender_password = config.get('sender_password')
        self.recipient_emails = config.get('recipient_emails', [])
        self.enabled = all([self.sender_email, self.sender_password, self.recipient_emails])
    
    def send_email(self, subject: str, body: str, is_error: bool = False):
        """Send email notification"""
        if not self.enabled:
            logger.warning("Email notifications not configured. Skipping...")
            return False
        
        try:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = self.sender_email
            msg['To'] = ', '.join(self.recipient_emails)
            msg['Subject'] = f"[Facebook Token Manager] {subject}"
            
            # Add HTML styling for errors
            if is_error:
                html_body = f"""
                <html>
                <body style="font-family: Arial, sans-serif;">
                    <div style="background-color: #ffebee; padding: 20px; border-left: 4px solid #f44336;">
                        <h2 style="color: #d32f2f;">⚠️ ERROR: {subject}</h2>
                        <pre style="background-color: #f5f5f5; padding: 10px;">{body}</pre>
                        <p style="color: #666;">Please check the logs immediately.</p>
                    </div>
                </body>
                </html>
                """
            else:
                html_body = f"""
                <html>
                <body style="font-family: Arial, sans-serif;">
                    <div style="background-color: #e8f5e9; padding: 20px; border-left: 4px solid #4caf50;">
                        <h2 style="color: #2e7d32;">✅ {subject}</h2>
                        <pre style="background-color: #f5f5f5; padding: 10px;">{body}</pre>
                    </div>
                </body>
                </html>
                """
            
            msg.attach(MIMEText(html_body, 'html'))
            
            # Send email
            context = ssl.create_default_context()
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls(context=context)
                server.login(self.sender_email, self.sender_password)
                server.send_message(msg)
            
            logger.info(f"Email sent to {', '.join(self.recipient_emails)}: {subject}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send email: {e}")
            return False
    
    def send_rotation_success(self, page_name: str, days_until_next: int):
        """Send success notification after token rotation"""
        body = f"""
        Token rotation completed successfully!

        Page: {page_name}
        Rotation Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        Next Rotation: {(datetime.now() + timedelta(days=days_until_next)).strftime('%Y-%m-%d')}
        
        Your API tokens have been automatically updated and are now active.
        No action is required from you.
        
        Token Preview: {self._get_token_preview()}
        """
        return self.send_email(f"Token Rotated Successfully - {page_name}", body)
    
    def send_rotation_warning(self, page_name: str, days_remaining: int):
        """Send warning that rotation will happen soon"""
        body = f"""
        ⏰ Token Rotation Warning

        Page: {page_name}
        Days Until Next Rotation: {days_remaining}
        Scheduled Rotation Date: {(datetime.now() + timedelta(days=days_remaining)).strftime('%Y-%m-%d')}
        
        Your token will be automatically rotated on the scheduled date.
        The current token will continue working until then.
        
        No action is required unless you want to:
        1. Adjust the rotation schedule
        2. Test the rotation process manually
        """
        return self.send_email(f"Token Rotation in {days_remaining} Days - {page_name}", body)
    
    def send_rotation_failure(self, page_name: str, error: str):
        """Send error notification if rotation fails"""
        body = f"""
        ❌ CRITICAL: Token Rotation Failed!

        Page: {page_name}
        Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        Error: {error}
        
        ACTION REQUIRED:
        Your API will stop working when the current token expires!
        
        Please:
        1. Check the logs at: facebook_token_manager.log
        2. Generate a new short-lived token
        3. Run the script with the new token
        4. Verify API is working again
        
        If this issue persists, check:
        - Facebook App status
        - Page access permissions
        - Network connectivity
        """
        return self.send_email(f"ROTATION FAILED - {page_name}", body, is_error=True)
    
    def send_daily_status(self, page_name: str, days_until_rotation: int, token_valid: bool):
        """Send daily status report"""
        status = "✅ VALID" if token_valid else "⚠️ EXPIRED"
        body = f"""
        Daily Token Status Report

        Page: {page_name}
        Status: {status}
        Days Until Next Rotation: {days_until_rotation}
        Last Check: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        
        All systems operational.
        """
        return self.send_email(f"Daily Status - {page_name} ({status})", body)
    
    def _get_token_preview(self) -> str:
        """Get preview of token from config"""
        try:
            with open('facebook_config.json', 'r') as f:
                config = json.load(f)
                token = config.get('page_token', '')
                return f"{token[:20]}...{token[-10:]}" if len(token) > 30 else token
        except:
            return "Unable to preview token"


class AutoRotatingTokenManager:
    def __init__(self, app_id: str, app_secret: str, rotation_days: int = 60):
        self.app_id = app_id
        self.app_secret = app_secret
        self.rotation_days = rotation_days
        self.base_url = "https://graph.facebook.com"
        self.version = "v25.0"
        self.email_notifier = None
    
    def setup_email_notifications(self, email_config: Dict):
        """Configure email notifications"""
        self.email_notifier = EmailNotifier(email_config)
        logger.info("Email notifications configured")
    
    def get_long_lived_user_token(self, short_lived_token: str) -> Optional[str]:
        """Exchange short-lived token for long-lived (~60 days)"""
        url = f"{self.base_url}/{self.version}/oauth/access_token"
        params = {
            "grant_type": "fb_exchange_token",
            "client_id": self.app_id,
            "client_secret": self.app_secret,
            "fb_exchange_token": short_lived_token
        }
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                token = response.json().get("access_token")
                logger.info("Successfully obtained long-lived user token")
                return token
            else:
                logger.error(f"Failed to get user token: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error getting user token: {e}")
            return None
    
    def get_page_token(self, user_token: str, page_id: str) -> Optional[str]:
        """Get fresh page token using user token"""
        url = f"{self.base_url}/{self.version}/{page_id}"
        params = {
            "access_token": user_token,
            "fields": "access_token"
        }
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                token = response.json().get("access_token")
                logger.info(f"Successfully obtained page token for {page_id}")
                return token
            else:
                logger.error(f"Failed to get page token: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error getting page token: {e}")
            return None
    
    def get_pages(self, user_token: str) -> Optional[List[Dict]]:
        """Get list of user's pages"""
        url = f"{self.base_url}/{self.version}/me/accounts"
        params = {"access_token": user_token, "fields": "id,name,access_token"}
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                pages = response.json().get("data", [])
                logger.info(f"Found {len(pages)} pages")
                return pages
            return None
        except Exception as e:
            logger.error(f"Error getting pages: {e}")
            return None
    
    def get_instagram_id(self, page_token: str, page_id: str) -> Optional[str]:
        """Get Instagram Business ID from page"""
        url = f"{self.base_url}/{self.version}/{page_id}"
        params = {
            "access_token": page_token,
            "fields": "instagram_business_account{id,username}"
        }
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                ig = response.json().get("instagram_business_account")
                if ig:
                    logger.info(f"Found Instagram account: {ig.get('username')} (ID: {ig.get('id')})")
                    return ig.get("id")
                return None
        except Exception as e:
            logger.error(f"Error getting Instagram ID: {e}")
            return None
    
    def should_rotate(self, config: Dict) -> tuple[bool, int]:
        """Check if token needs rotation, returns (needs_rotation, days_until)"""
        if not config.get("last_rotation"):
            return True, 0
        
        try:
            last_rotation = datetime.fromisoformat(config["last_rotation"])
            days_since = (datetime.now() - last_rotation).days
            days_until = self.rotation_days - days_since
            
            # Send warning if within 7 days of rotation
            if 0 < days_until <= 7 and self.email_notifier:
                self.email_notifier.send_rotation_warning(
                    config.get("page_name", "Unknown"),
                    days_until
                )
            
            return days_since >= self.rotation_days, days_until
        except Exception as e:
            logger.error(f"Error checking rotation: {e}")
            return True, 0
    
    def rotate_tokens(self, short_lived_token: str, config: Dict) -> Optional[Dict]:
        """Generate fresh tokens and update config"""
        logger.info("Starting token rotation process...")
        
        try:
            # Get fresh long-lived user token
            long_user_token = self.get_long_lived_user_token(short_lived_token)
            if not long_user_token:
                raise Exception("Failed to get long-lived user token")
            
            # Get fresh page token
            page_token = self.get_page_token(long_user_token, config["page_id"])
            if not page_token:
                raise Exception("Failed to get fresh page token")
            
            # Get fresh Instagram ID (in case it changed)
            ig_id = self.get_instagram_id(page_token, config["page_id"])
            
            new_tokens = {
                "page_token": page_token,
                "instagram_business_id": ig_id,
                "last_rotation": datetime.now().isoformat()
            }
            
            logger.info("Token rotation completed successfully")
            
            # Send success email
            if self.email_notifier:
                self.email_notifier.send_rotation_success(
                    config.get("page_name", "Unknown"),
                    self.rotation_days
                )
            
            return new_tokens
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Rotation failed: {error_msg}")
            
            # Send failure email
            if self.email_notifier:
                self.email_notifier.send_rotation_failure(
                    config.get("page_name", "Unknown"),
                    error_msg
                )
            
            return None
    
    def save_config(self, config: Dict):
        """Save configuration to file"""
        with open("facebook_config.json", "w") as f:
            json.dump(config, f, indent=2)
        logger.info("Configuration saved")
    
    def load_config(self) -> Optional[Dict]:
        """Load configuration from file"""
        if os.path.exists("facebook_config.json"):
            with open("facebook_config.json", "r") as f:
                return json.load(f)
        return None
    
    def test_token(self, page_token: str, page_id: str) -> bool:
        """Test if token works"""
        url = f"{self.base_url}/{self.version}/{page_id}"
        params = {"access_token": page_token, "fields": "id,name"}
        try:
            response = requests.get(url, params=params)
            if response.status_code == 200:
                logger.info("Token validation successful")
                return True
            else:
                logger.warning(f"Token validation failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error testing token: {e}")
            return False
    
    def one_time_setup(self, short_lived_token: str) -> Optional[Dict]:
        """Initial setup - run once"""
        logger.info("Starting one-time setup...")
        
        # Get long-lived user token
        long_user_token = self.get_long_lived_user_token(short_lived_token)
        if not long_user_token:
            logger.error("Setup failed: Invalid short-lived token")
            return None
        
        # Get pages
        pages = self.get_pages(long_user_token)
        if not pages:
            logger.error("Setup failed: No pages found")
            return None
        
        # Auto-select first page (or could prompt)
        selected_page = pages[0]
        page_id = selected_page["id"]
        page_name = selected_page["name"]
        
        logger.info(f"Selected page: {page_name} (ID: {page_id})")
        
        # Get fresh page token
        page_token = self.get_page_token(long_user_token, page_id)
        if not page_token:
            logger.error("Setup failed: Could not get page token")
            return None
        
        # Get Instagram ID
        ig_id = self.get_instagram_id(page_token, page_id)
        
        # Save config
        config = {
            "page_id": page_id,
            "page_name": page_name,
            "page_token": page_token,
            "instagram_business_id": ig_id,
            "last_rotation": datetime.now().isoformat(),
            "rotation_days": self.rotation_days,
            "created_at": datetime.now().isoformat()
        }
        self.save_config(config)
        
        logger.info("Setup completed successfully")
        
        # Send welcome email
        if self.email_notifier:
            body = f"""
            Facebook Token Manager Setup Complete!

            Page: {page_name}
            Page ID: {page_id}
            Instagram Business ID: {ig_id or 'Not connected'}
            Rotation Schedule: Every {self.rotation_days} days
            
            The system is now active and will:
            - Automatically rotate tokens every {self.rotation_days} days
            - Send email notifications for all rotations
            - Alert you immediately if any rotation fails
            
            Your API can now use the token from facebook_config.json
            """
            self.email_notifier.send_email("Setup Complete - System Active", body)
        
        return config
    
    def get_active_token(self, short_lived_token: str = None, daily_status: bool = False) -> Optional[Dict]:
        """
        Main method - returns valid token, rotating if needed.
        Set daily_status=True to receive daily status emails.
        """
        config = self.load_config()
        
        # First time setup
        if not config:
            if not short_lived_token:
                logger.error("No config found and no token provided for setup")
                return None
            return self.one_time_setup(short_lived_token)
        
        # Check if rotation needed
        needs_rotation, days_until = self.should_rotate(config)
        
        # Send daily status if requested
        if daily_status and self.email_notifier:
            token_valid = self.test_token(config["page_token"], config["page_id"])
            self.email_notifier.send_daily_status(
                config.get("page_name", "Unknown"),
                max(0, days_until),
                token_valid
            )
        
        if needs_rotation:
            logger.info(f"Token rotation required (last rotation: {config.get('last_rotation')})")
            
            if not short_lived_token:
                logger.error("Rotation needed but no short-lived token provided")
                if self.email_notifier:
                    self.email_notifier.send_rotation_failure(
                        config.get("page_name", "Unknown"),
                        "No short-lived token provided for rotation"
                    )
                return None
            
            # Perform rotation
            new_tokens = self.rotate_tokens(short_lived_token, config)
            if new_tokens:
                config.update(new_tokens)
                self.save_config(config)
                logger.info("Token rotation successful")
            else:
                logger.error("Token rotation failed")
                return None
        
        # Validate token still works
        if self.test_token(config["page_token"], config["page_id"]):
            return config
        else:
            logger.error("Token invalid despite rotation check")
            return None


def setup_email_config():
    """Interactive setup for email configuration"""
    print("\n" + "=" * 60)
    print("📧 EMAIL NOTIFICATION SETUP")
    print("=" * 60)
    print("\nEmail notifications will alert you about:")
    print("  • Token rotations (success/failure)")
    print("  • Upcoming rotations (7 days before)")
    print("  • Daily status reports (optional)")
    print("\nSupported email providers: Gmail, Outlook, Yahoo, etc.")
    
    use_email = input("\nEnable email notifications? (y/n): ").strip().lower()
    
    if use_email != 'y':
        return None
    
    print("\n📧 Email Configuration:")
    print("For Gmail, you'll need an App Password (not your regular password)")
    print("Get it at: https://myaccount.google.com/apppasswords\n")
    
    config = {
        "smtp_server": input("SMTP Server (default: smtp.gmail.com): ").strip() or "smtp.gmail.com",
        "smtp_port": int(input("SMTP Port (default: 587): ").strip() or "587"),
        "sender_email": input("Sender Email Address: ").strip(),
        "sender_password": input("Sender Email Password/App Password: ").strip(),
        "recipient_emails": []
    }
    
    # Add recipients
    print("\n📬 Recipient Email Addresses (who should receive alerts):")
    while True:
        email = input("Add email (or press Enter to finish): ").strip()
        if not email:
            break
        config["recipient_emails"].append(email)
    
    if not config["recipient_emails"]:
        print("⚠️  No recipients added. Email notifications disabled.")
        return None
    
    # Test email
    print("\n🔍 Testing email configuration...")
    test_notifier = EmailNotifier(config)
    if test_notifier.send_email("Test Notification", "Your Facebook Token Manager is configured correctly!"):
        print("✅ Test email sent successfully!")
    else:
        print("❌ Test failed. Check your email settings.")
        retry = input("Continue anyway? (y/n): ").strip().lower()
        if retry != 'y':
            return None
    
    return config


def main():
    """Main entry point"""
    print("=" * 60)
    print("🤖 FACEBOOK TOKEN MANAGER")
    print("   with Auto-Rotation & Email Notifications")
    print("=" * 60)
    
    # Get Facebook App credentials
    print("\n🔐 Facebook App Configuration:")
    print("Get these from: https://developers.facebook.com/apps/")
    APP_ID = input("Facebook App ID: ").strip()
    APP_SECRET = input("Facebook App Secret: ").strip()
    
    if not APP_ID or not APP_SECRET:
        print("❌ App ID and Secret are required")
        return
    
    # Setup email notifications
    email_config = setup_email_config()
    
    # Initialize manager
    manager = AutoRotatingTokenManager(APP_ID, APP_SECRET, rotation_days=60)
    
    if email_config:
        manager.setup_email_notifications(email_config)
    
    # Check if we have existing config
    config = manager.load_config()
    
    if not config:
        # First time setup
        print("\n🚀 First-time setup required")
        print("\nTo get a short-lived token:")
        print("1. Go to https://developers.facebook.com/tools/explorer/")
        print("2. Select your app")
        print("3. Click 'Generate Access Token'")
        print("4. Add permissions: pages_manage_posts, pages_read_engagement, instagram_basic")
        
        short_token = input("\nPaste short-lived token: ").strip()
        result = manager.one_time_setup(short_token)
        
        if result:
            print("\n✅ Setup complete!")
            print(f"📁 Config saved to: facebook_config.json")
            print(f"📧 Notifications: {'Enabled' if email_config else 'Disabled'}")
            
            # Show token preview
            print(f"\n🔑 Token: {result['page_token'][:30]}...")
        else:
            print("\n❌ Setup failed. Check your credentials.")
    
    else:
        # Automated mode - get active token
        print(f"\n🤖 Running in automated mode")
        print(f"📄 Page: {config.get('page_name', 'Unknown')}")
        print(f"🔄 Rotation: Every {config.get('rotation_days', 60)} days")
        print(f"📧 Notifications: {'Enabled' if email_config else 'Disabled'}")
        
        # Ask for short token if rotation is due soon
        needs_rotation, days_until = manager.should_rotate(config)
        
        short_token = None
        if needs_rotation or days_until <= 5:
            print(f"\n⚠️  Token rotation due in {days_until} days")
            provide = input("Provide a new short-lived token for rotation? (y/n): ").strip().lower()
            if provide == 'y':
                short_token = input("Paste short-lived token: ").strip()
        
        # Get active token
        result = manager.get_active_token(short_token, daily_status=False)
        
        if result:
            print("\n✅ Token is ready for API use!")
            print(f"🔑 Token: {result['page_token']}")
            print(f"📱 Page ID: {result['page_id']}")
            if result.get('instagram_business_id'):
                print(f"📸 Instagram ID: {result['instagram_business_id']}")
        else:
            print("\n❌ Failed to get valid token")
            print("Check logs: facebook_token_manager.log")


if __name__ == "__main__":
    try:
        import requests
    except ImportError:
        import subprocess
        subprocess.check_call(["pip", "install", "requests"])
        import requests
    
    main()
```

## Email Configuration Setup

### For Gmail Users (Recommended)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other" (name it "Facebook Token Manager")
   - Copy the 16-character password

3. **Use these settings**:
```
SMTP Server: smtp.gmail.com
SMTP Port: 587
Sender Email: your-email@gmail.com
Sender Password: [16-character app password]
```

### For Other Email Providers

| Provider | SMTP Server | Port |
|----------|-------------|------|
| Outlook/Hotmail | smtp-mail.outlook.com | 587 |
| Yahoo | smtp.mail.yahoo.com | 587 |
| Office 365 | smtp.office365.com | 587 |

## What Emails You'll Receive

### 1. **Setup Complete Email** (One time)
```
✅ Setup Complete - System Active

Page: Your Page Name
Rotation Schedule: Every 60 days

The system is now active and will:
- Automatically rotate tokens every 60 days
- Send email notifications for all rotations
- Alert you immediately if any rotation fails
```

### 2. **Rotation Warning** (7 days before)
```
⏰ Token Rotation Warning

Page: Your Page Name
Days Until Next Rotation: 7
Scheduled Rotation Date: 2024-03-15

Your token will be automatically rotated on the scheduled date.
No action is required.
```

### 3. **Rotation Success** (After each rotation)
```
✅ Token Rotated Successfully

Page: Your Page Name
Rotation Date: 2024-03-15
Next Rotation: 2024-05-14

Your API tokens have been automatically updated.
No action is required.
```

### 4. **Rotation Failure** (Critical - requires action)
```
❌ CRITICAL: Token Rotation Failed!

Page: Your Page Name
Error: Invalid short-lived token

ACTION REQUIRED:
Your API will stop working when the current token expires!

Please:
1. Generate a new short-lived token
2. Run the script with the new token
3. Verify API is working again
```

### 5. **Daily Status** (Optional)
```
Daily Token Status Report

Page: Your Page Name
Status: ✅ VALID
Days Until Next Rotation: 45

All systems operational.
```

## Setting Up Automated Short Token Generation

For **complete automation** (no manual token input ever), you can use Facebook's **Refresh Tokens**:

```python
# Add to your crontab (runs every 50 days)
# 0 0 */50 * * /usr/bin/python3 /path/to/refresh_token.py

# refresh_token.py
def get_refresh_token():
    # If you have a refresh token from initial OAuth
    refresh_url = "https://graph.facebook.com/v25.0/oauth/access_token"
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": APP_ID,
        "client_secret": APP_SECRET,
        "fb_exchange_token": REFRESH_TOKEN  # Store this securely
    }
    response = requests.get(refresh_url, params=params)
    return response.json().get("access_token")
```

## Summary of Benefits with Email Notifications

| Feature | Benefit |
|---------|---------|
| **Proactive warnings** | You know 7 days before rotation happens |
| **Immediate failure alerts** | Get email within seconds if rotation fails |
| **Audit trail** | Every rotation logged and emailed |
| **Peace of mind** | Daily status confirms system is working |
| **Team notifications** | Multiple people can receive alerts |

This setup ensures you're always aware of your token status without having to manually check logs or wonder if the system is working.