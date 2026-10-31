# AutoCover
## Smart Vehicle Insurance Comparison Platform

**Full-Stack Engineering Assignment**

**Difficulty:** Intermediate
**Expected duration:** 2–3 days
**Technology:** Candidate's choice (recommended stack: React, TypeScript, Python, FastAPI, PostgreSQL)
**AI tools:** Permitted

---

## 1. Background

Imagine a customer whose car insurance policy is about to expire.

To renew their insurance, they currently need to visit multiple insurance provider websites, enter their vehicle information repeatedly, collect available plans and compare premiums, coverage, add-ons and other benefits.

This process is time-consuming and makes it difficult to identify the most suitable option.

We want to simplify this experience.

Your task is to build **AutoCover**, a platform that collects insurance information from multiple providers, processes it into a consistent format and presents the customer with a clear comparison of available insurance plans.

The customer should be able to enter their vehicle registration number once, review the available options, select a plan and save their policy information.

The objective is to build a working information aggregation and comparison platform.

## 2. Core requirements

### Part A — Vehicle information

Build a vehicle lookup experience.

The user should be able to:

- Enter a vehicle registration number.
- Retrieve the available vehicle information.
- View and verify the retrieved details.
- Correct relevant information if necessary.
- Proceed to insurance plan discovery.

Display information such as:

- Registration number
- Manufacturer and model
- Variant
- Fuel type
- Registration year
- Registration location
- Existing policy expiry date, if available

Use the provided vehicle data source (`data/registry.json`).

### Part B — Information collection

Build a mechanism to collect insurance information from multiple independent providers.

You are given data from four simulated insurance providers (see section 3). They provide information in different formats:

- JSON responses
- HTML pages, including JavaScript-rendered content
- Downloadable documents (PDF)
- CSV exports

Your application should:

- Investigate and retrieve information from the available sources.
- Handle different response structures.
- Extract relevant insurance plan information.
- Handle missing or incomplete information.
- Handle slow or unavailable providers.
- Avoid duplicate records.
- Convert the collected information into a consistent structure.

You are not required to integrate real insurance companies or purchase actual policies.

### Part C — Data processing and comparison

Create a common data structure for the insurance plans collected from different providers.

The comparison should consider:

- Insurance provider
- Plan name
- Total premium
- GST
- Insured Declared Value (IDV)
- Coverage type
- Available add-ons
- Other relevant benefits
- Quote validity, where available

The system should account for differences in how providers represent their information.

**Add-on glossary.** Providers use different names for add-ons. Research the public add-on pages of **at least three real insurers** (see section 3.3) and use them to build a glossary that maps each provider's add-on names to common concepts. Record the pages you used.

Present the available plans in a way that makes comparison easy.

Users should be able to:

- View available plans.
- Sort by price.
- Filter by coverage or add-ons.
- Compare important plan attributes.
- Understand why one plan may be preferable to another.
- Select a plan.

Do not assume that the cheapest plan is automatically the best option.

### Part D — Policy management

After selecting a plan, the user should be able to review and confirm their selection.

Implement a mock confirmation process.

No actual insurance purchase or payment integration is required.

Create a policy management section where users can:

- View their selected policies.
- See the associated vehicle.
- View the selected provider and plan.
- See the premium and policy dates.
- Identify policies approaching expiry.

Persist relevant information in a database.

## 3. Data sources

### 3.1 Provided files (`data/`)

| File | What it is |
|---|---|
| `registry.json` | Vehicle registry extract |
| `provider_a.json` | Provider A: quote API response |
| `provider_b.html` | Provider B: saved quote results page |
| `provider_c.pdf` | Provider C: rate card |
| `provider_d.csv` | Provider D: quote export |
| `test_customers.json` | Test customers and registration numbers to try |

The sources are intentionally different in how they expose their information. There is no further documentation: your responsibility is to investigate these sources and determine how to retrieve and interpret the required information.

**Reference date:** treat **10 November 2026 (IST)** as "today" for anything that depends on the date (quote validity, policy expiry). Keep it configurable.

### 3.2 Treat each provider as an external service

In the real world each provider is a separate system that can be slow or fail. Serve each provider's file through **your own small mock service** (one per provider, or one service with separate endpoints), and have your application collect from those services, not by reading the files directly.

Make at least one provider **slow** and one **intermittently failing**, and show how your application copes. You may build this yourself or use public test endpoints such as `https://httpbin.org/delay/5` and `https://httpbin.org/status/503`.

### 3.3 Public information you may use

You may use public information to understand and enrich the data, for example:

- The General Insurance Council's IDV calculator: https://idv.gicouncil.in/
- Insurers' public pages that explain car insurance add-ons and IDV.

Rules: read only public pages; respect each website's `robots.txt` and terms of use; do not use quote forms, logins or OTPs; do not bypass CAPTCHAs or bot protection. Real insurers' prices are not public. **All plan prices come from the provided files.**

**Optional: enrich from more public sources.** You may pull extra information from other public sources (for example RTO code to city/state, official third-party premium rates, IDV ranges from the GI Council calculator) to fill gaps or cross-check the providers. For every value, keep its source URL and the date you fetched it, and show it separately from provider data. Your application must still work if that source is down. Plan prices must still come only from the provided files.

## 4. Technical expectations

You are free to choose your implementation approach.

We recommend:

**Frontend**
- React
- TypeScript
- Responsive UI

**Backend**
- Python
- FastAPI
- Pydantic

**Database**
- PostgreSQL

**Testing**
- pytest or an equivalent testing framework

You may use other technologies if you can explain your decisions.

Your implementation should demonstrate:

- Clear separation of responsibilities.
- Reusable components and services.
- Reasonable database design.
- Error handling.
- Input validation.
- Maintainable code.
- Appropriate testing.

You do not need to over-engineer the application.

## 5. Expected user experience

Your application should cover the following user journey:

1. Enter vehicle registration number.
2. Retrieve and verify vehicle details.
3. Initiate insurance information collection.
4. View collection progress or meaningful loading states.
5. Review available insurance plans.
6. Compare, filter and sort plans.
7. Select and confirm a plan.
8. View the saved policy in the policy dashboard.

The interface should be intuitive and usable on both desktop and mobile screens.

## 6. Optional enhancements

These features are not mandatory and should only be attempted after the core requirements are working.

**Notifications**
- Send a notification when comparison results are available.
- Send confirmation after plan selection.
- Use the WhatsApp Cloud API test number, Telegram, or a mock notification service.

**Renewal reminders**
- Identify policies expiring within 15 days.
- Implement a scheduled reminder mechanism.
- Prevent duplicate reminders.

**Deployment**
- Deploy the application so we can open it from a link (any free hosting is fine). Put the link at the top of your README.
- A deployed app is a plus, not a requirement. A clean local setup is enough.

**Additional improvements**
- Quote history.
- Retry failed providers.
- Background processing.
- More advanced plan ranking.
- Improved comparison experience.

## 7. Submission requirements

Please submit:

1. Source code for the complete application (a link to your own repository).
2. README with clear setup and run instructions: prerequisites, environment variables (with a `.env.example`), how to create the database, how to start the mock provider services, backend and frontend, and how to run the tests. We will follow it step by step on a fresh machine.
3. Database schema or migrations.
4. Description of how you investigated and integrated the data sources.
5. Explanation of your data normalisation approach, including your add-on glossary and its sources.
6. Details of important technical decisions and trade-offs.
7. Tests covering important application behaviour.
8. Screenshots or a short demonstration video of the working application.
9. If you used AI tools: an `AI_USAGE.md` file listing the tools you used and the main prompts you gave them (copy them as written, in order), with a short note on what you changed or fixed in the AI's output.
10. If you deployed it: the live link.

The application should be runnable locally using the instructions provided.

Please build in **your own new repository**. Do not open pull requests or issues on this one.

## 8. Use of AI tools

You are permitted to use AI coding assistants and other development tools.

However:

- You must understand the code you submit.
- You must be able to explain your architecture.
- You must be able to explain the data extraction and processing logic.
- You must list the AI tools and the main prompts you used in `AI_USAGE.md` (see section 7).
- You are responsible for the correctness and reliability of the final application.

We evaluate engineering understanding, not the amount of code written manually.

## 9. What we are looking for

We are interested in how you approach an unfamiliar engineering problem.

We will consider:

- Your ability to investigate unfamiliar data sources.
- How you extract and process information.
- How you handle inconsistent data.
- How you design a reliable backend.
- How you structure your frontend.
- How you handle failures and edge cases.
- Your attention to the user experience.
- Your ability to explain technical decisions.

We do not expect a production-ready insurance platform.

We expect a working, thoughtfully engineered solution that demonstrates your ability to take a problem from investigation to implementation.

**Good luck!**

---

*All vehicles, customers, phone numbers, providers and prices in this repository are fictional and exist only for this assignment.*
