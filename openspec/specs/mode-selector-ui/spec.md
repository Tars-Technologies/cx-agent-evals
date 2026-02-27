## Purpose

Landing page with mode selection cards for choosing between "Generate Questions", "Retrievers", and "Run Experiments" flows.

## Requirements

### Requirement: Mode selector landing page
The system SHALL provide a landing page titled "CX Agent Evals" with three large selectable cards: "Generate Questions", "Retrievers", and "Run Experiments". Each card SHALL have a title, brief description, and navigate to the appropriate page on click. The grid SHALL use a three-column layout on medium+ screens with a `max-w-5xl` container for comfortable card width.

#### Scenario: Landing page displays three mode cards
- **WHEN** user visits the root URL
- **THEN** the page SHALL display the "CX Agent Evals" heading and three prominent cards for "Generate Questions", "Retrievers", and "Run Experiments"

#### Scenario: Retrievers card navigates to retrievers page
- **WHEN** user clicks the "Retrievers" card
- **THEN** the app SHALL navigate to `/retrievers`

#### Scenario: Generate Questions card navigates to generate page
- **WHEN** user clicks the "Generate Questions" card
- **THEN** the app SHALL navigate to the question generation flow

#### Scenario: Run Experiments card navigates to experiments page
- **WHEN** user clicks the "Run Experiments" card
- **THEN** the app SHALL navigate to `/experiments`

### Requirement: Mode card descriptions
The "Generate Questions" card SHALL display description: "Create synthetic evaluation datasets with ground truth spans for RAG retrieval testing". The "Retrievers" card SHALL display description: "Configure, index, and test retrieval pipelines against your knowledge bases". The "Run Experiments" card SHALL display description: "Run retrieval experiments on LangSmith datasets and compare results across configurations". Each card SHALL also display a step-by-step flow hint (e.g., "Select KB -> Configure & index -> Test & compare").

#### Scenario: Cards show descriptions
- **WHEN** viewing the landing page
- **THEN** each card SHALL display its title, descriptive subtitle, and step-by-step flow hint

### Requirement: Mode indicator in header
The system SHALL display "CX Agent Evals" as the app name in the header (linking to the landing page) and mode tabs when on generate, retrievers, or experiments pages, allowing users to switch between modes without returning to the landing page. Tab labels SHALL use short names: "Generate", "Retrievers", "Experiments".

#### Scenario: Header shows mode tabs on retrievers page
- **WHEN** user is on the retrievers page
- **THEN** the header SHALL show "Retrievers" as active and the other two modes as clickable

#### Scenario: Header shows three tabs
- **WHEN** user is on any mode page
- **THEN** the header SHALL show all three mode tabs: "Generate", "Retrievers", and "Experiments"

#### Scenario: Clicking inactive tab navigates
- **WHEN** user clicks an inactive mode tab in the header
- **THEN** the app SHALL navigate to that mode's page
