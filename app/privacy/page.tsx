export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.7, color: "#222" }}>
      <h1>Content Matrix — Privacy Policy</h1>
      <p><em>Last updated: June 1, 2026</em></p>

      <h2>1. Information We Collect</h2>
      <p>Content Matrix collects the following information:</p>
      <ul>
        <li>Video files you upload for processing</li>
        <li>TikTok and YouTube account access tokens (stored locally in your environment)</li>
        <li>Job metadata: video titles, descriptions, tags, and translation data</li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To process and translate your video content</li>
        <li>To publish videos to your connected TikTok and YouTube accounts on your behalf</li>
        <li>To store job history and processing results</li>
      </ul>

      <h2>3. TikTok Data</h2>
      <p>When you connect your TikTok account, Content Matrix:</p>
      <ul>
        <li>Obtains an access token via TikTok&apos;s OAuth flow</li>
        <li>Uses the token solely to call the TikTok Content Posting API on your behalf</li>
        <li>Does not share your TikTok credentials with any third parties</li>
        <li>Stores tokens locally in your application environment</li>
      </ul>

      <h2>4. Data Storage</h2>
      <p>All data is stored locally on your own infrastructure. Content Matrix does not transmit your content or credentials to any external servers beyond the TikTok and YouTube APIs you explicitly authorize.</p>

      <h2>5. Data Retention</h2>
      <p>You control your data. You may delete job records and video files at any time through the application interface.</p>

      <h2>6. Contact</h2>
      <p>For privacy-related questions, please contact the application administrator.</p>
    </main>
  );
}
