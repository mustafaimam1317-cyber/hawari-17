import fs from 'fs';

const questions = [
  {
    id: "swe_q01",
    text: "Each of the following statements concerning Giardia lamblia is correct EXCEPT:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "G. lamblia has both a trophozoite and cyst stage in its life cycle",
      B: "G. lamblia is transmitted by the fecal-oral route from both human and animal sources",
      C: "G. lamblia causes hemolytic anemia",
      D: "G. lamblia can be diagnosed by the string test"
    },
    correctOption: "C",
    explanation: "Giardia lamblia Profile: A flagellated non-invasive protozoan that exists as flagellated trophozoites (in the upper small intestine) and infectious quadrinucleate cysts.\nClinical Features: Transmitted via fecal-oral ingestion of cysts (zoonotic reservoirs include beavers and domestic animals). Diagnosed via stool microscopy/antigen testing or duodenal string test (Entero-Test). It causes malabsorption and steatorrhea, not intravascular hemolysis or anemia.\nOption Analysis:\n- a, b, d: Factually correct statements regarding life cycle, transmission routes, and diagnostic methods.\n- c (Correct Exception): Incorrect statement; Giardia does not cause hemolytic anemia.",
    highlightedHtml: ""
  },
  {
    id: "swe_q02",
    text: "A protozoan cyst that contains four nuclei, median bodies, and axonemes should be identified as:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Giardia lamblia",
      B: "Trichomonas vaginalis",
      C: "Dientamoeba fragilis",
      D: "Pentatrichomonas hominis"
    },
    correctOption: "A",
    explanation: "G. lamblia Cyst Morphology: Oval-shaped cyst (8–12 µm) containing four nuclei (in mature cysts), transverse claw-like median (parabasal) bodies, and intracytoplasmic axonemes (flagellar filaments).\nOption Analysis:\n- b & d (T. vaginalis / P. hominis): Possess only trophozoite stages; no cyst stage exists in their life cycle.\n- c (D. fragilis): Trophozoites typically contain 1–2 binucleate structures; lacks a recognized true cyst stage.",
    highlightedHtml: ""
  },
  {
    id: "swe_q03",
    text: "The pathogenic protozoon with extra-intestinal spread through blood is:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Giardia lamblia",
      B: "Entamoeba coli",
      C: "Isospora belli",
      D: "Entamoeba histolytica"
    },
    correctOption: "D",
    explanation: "Entamoeba histolytica Invasiveness: Trophozoites breach the colonic epithelium via cysteine proteinases, entering the portal circulation.\nExtra-intestinal Spread: Disseminates via portal blood to cause amoebic liver abscess (\"anchovy-sauce\" pus) and distant metastatic brain or lung lesions.\nOption Analysis:\n- a (Giardia): Non-invasive duodenal protozoan; no blood invasion.\n- b (E. coli): Non-pathogenic lumen-dwelling commensal.\n- c (Isospora belli): Intracellular enterocyte parasite; systemic hematogenous dissemination is extremely rare.",
    highlightedHtml: ""
  },
  {
    id: "swe_q04",
    text: "Liver abscess is a known complication of infection with:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Fasciola hepatica",
      B: "Giardia lamblia",
      C: "Schistosoma mansoni",
      D: "Entamoeba histolytica"
    },
    correctOption: "D",
    explanation: "Amoebic Liver Abscess: The primary extra-intestinal complication of E. histolytica. Trophozoites breach intestinal mucosa, travel via portal venous circulation, and induce focal necrotic liver lesions containing brownish fluid.\nOption Analysis:\n- a (Fasciola hepatica): Biliary trematode causing bile duct inflammation and fibrosis, not necrotic amoebic abscesses.\n- b (Giardia): Non-invasive upper small intestine parasite.\n- c (Schistosoma mansoni): Causes periportal Symmers' pipe-stem fibrosis and portal hypertension.",
    highlightedHtml: ""
  },
  {
    id: "swe_q05",
    text: "Cryptosporidium multiplies in:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "The lumen of small intestine",
      B: "The brush border of epithelial lining of small intestine",
      C: "The lumen of large intestine",
      D: "None of the above"
    },
    correctOption: "B",
    explanation: "Cryptosporidium Intracellular Habitat: An intracellular, extracytoplasmic parasite. Sporozoites attach to enterocytes in the small intestine, becoming enveloped by host microvillar membranes (brush border) within a parasitophorous vacuole.\nOption Analysis:\n- a & c: Incorrect; Cryptosporidium is not a free lumen-dwelling organism.\n- b (Correct): Accurately specifies its microvillar brush border location.",
    highlightedHtml: ""
  },
  {
    id: "swe_q06",
    text: "Flask-shaped ulcers in the colon are caused by:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Giardia lamblia",
      B: "Acanthamoeba",
      C: "Entamoeba histolytica",
      D: "Naegleria fowleri"
    },
    correctOption: "C",
    explanation: "Flask-Shaped Ulcers: Pathognomonic histopathological lesion of intestinal amoebiasis. Trophozoites breach mucosal epithelium and spread laterally in the submucosa, producing narrow-necked, wide-based \"flask-shaped\" mucosal ulcers.\nOption Analysis:\n- a (Giardia): Non-ulcerative pathogen.\n- b & d (Acanthamoeba / Naegleria): Free-living amoebae affecting the CNS, cornea, or skin.",
    highlightedHtml: ""
  },
  {
    id: "swe_q07",
    text: "The following are true about Cryptosporidium:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Minimum infective dose = 10 to 100 oocysts",
      B: "Oocysts can persist in the natural environment for long periods of time",
      C: "C. parvum oocyst is able to survive for several days in mild chlorine",
      D: "All are correct"
    },
    correctOption: "D",
    explanation: "Cryptosporidium Properties: Has a very low infectious dose (10–100 oocysts), persistent environmental stability due to its double-layered wall, and marked resistance to routine municipal chlorination.\nOption Analysis:\n- a, b, c: All statements are verified microbiological facts.\n- d (Correct): Encompasses all correct options.",
    highlightedHtml: ""
  },
  {
    id: "swe_q08",
    text: "Cryptosporidium parvum can be diagnosed in stool samples by:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Microscopy (Modified Ziehl-Neelsen stain, fluorescence)",
      B: "Enzyme immunoassay",
      C: "Molecular biology methods (PCR)",
      D: "All are correct"
    },
    correctOption: "D",
    explanation: "Diagnostic Modalities: Diagnosed via Modified Acid-Fast (Z-N) microscopy (showing pink 4–6 µm oocysts), Enzyme Immunoassay (EIA) stool antigen detection, or PCR molecular panels.\nOption Analysis:\n- a, b, c: All are established diagnostic methods in clinical parasitology.\n- d (Correct): Encompasses all diagnostic modalities.",
    highlightedHtml: ""
  },
  {
    id: "swe_q09",
    text: "The World Health Organisation's Expanded Programme for Immunisation (EPI) includes routine immunisation against:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Cholera",
      B: "Hepatitis A",
      C: "Dengue fever",
      D: "Measles",
      E: "Typhoid"
    },
    correctOption: "D",
    explanation: "WHO EPI Core Targets: The WHO Expanded Programme on Immunization (EPI) was established in 1974 to protect children globally against key vaccine-preventable infectious diseases.\nCore Schedule: The original core target diseases in the primary childhood schedule are:\n1. Tuberculosis (BCG)\n2. Poliomyelitis (OPV / IPV)\n3. Diphtheria (DPT)\n4. Pertussis (DPT)\n5. Tetanus (DPT / Tetanus toxoid)\n6. Measles (given at 9–12 months)\n7. Hepatitis B & Haemophilus influenzae type b (Hib) (added in expanded schedules).\nOption Analysis:\n- A. Cholera: Not included in the routine global infant EPI schedule; reserved for outbreak control or endemic emergency response.\n- B. Hepatitis A: Not a routine global baseline EPI vaccine; aimed primarily at high-risk groups, travelers, or selective national guidelines.\n- C. Dengue fever: Not part of the routine global childhood EPI schedule due to complex serotype-specific indications.\n- D. Measles (Correct): A primary founding pillar of the WHO EPI childhood immunization program worldwide.\n- E. Typhoid: Not part of routine universal infant EPI; used for travelers or targeted endemic area prevention.",
    highlightedHtml: ""
  },
  {
    id: "swe_q10",
    text: "A 19-year-old man presents with a compound fracture of his leg following a fall from scaffolding. Examination reveals soiling of the wound with mud. He is certain he has received five prior tetanus vaccinations. What is the most appropriate course of action to prevent tetanus?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Clean wound + intramuscular human tetanus immunoglobulin",
      B: "Clean wound + tetanus vaccine",
      C: "Clean wound + tetanus vaccine + intramuscular human tetanus immunoglobulin",
      D: "Clean wound + tetanus vaccine + benzylpenicillin",
      E: "Clean wound"
    },
    correctOption: "A",
    explanation: "High-Risk (Tetanus-Prone) Wound: Heavy soil/mud contamination in a compound fracture represents a high-risk wound with high potential for Clostridium tetani spore germination under anaerobic conditions.\nProphylaxis Protocol: In a fully immunized individual (5 prior doses), additional tetanus toxoid vaccine is not required as 5 doses confer lifelong active immunity. However, for high-risk heavily contaminated wounds, immediate passive protection via Human Tetanus Immunoglobulin (TIG) is indicated regardless of vaccination status.\nOption Analysis:\n- B & C (Adding Tetanus Vaccine): Unnecessary because a complete 5-dose primary/booster series provides full long-term active protection; additional vaccine doses do not add benefit and increase local adverse reaction risks.\n- D (Adding Benzylpenicillin): Antibiotics are not a substitute for thorough surgical debridement and passive immunization with TIG.\n- E (Clean wound alone): Inadequate for heavy soil-contaminated compound fractures, which require immediate passive neutralization of potential tetanospasmin toxin using TIG.",
    highlightedHtml: ""
  },
  {
    id: "swe_q11",
    text: "A 38-year-old HIV-positive woman at 38 weeks gestation who is compliant with cART and has a consistently undetectable viral load (<50 copies/mL) asks for advice regarding breastfeeding after delivery. What would you advise her?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "She can breastfeed regardless of the viral load",
      B: "Breastfeeding is not recommended",
      C: "She can breastfeed as long as the baby is on neonatal antiretroviral therapy",
      D: "She can breastfeed to a maximum of approximately 100ml a day",
      E: "She can breastfeed as long as the viral load remains at <50 copies"
    },
    correctOption: "B",
    explanation: "Vertical Transmission Risk: Breast milk carries a residual risk of HIV transmission (~0.1–0.5%) even when maternal viral load is fully suppressed (<50 copies/mL).\nStandard Guidance (BHIVA / High-Income Settings): Where safe water and formula are readily available, exclusive formula feeding is recommended to completely eliminate the risk of postnatal vertical transmission.\nOption Analysis:\n- A. Regardless of viral load: Incorrect; unsuppressed maternal viral load significantly increases postnatal transmission risk (up to 15–20%).\n- C. Infant ART alone: Infant PEP reduces but does not eliminate ongoing transmission risk from breast milk.\n- D. Volume capping: Breast milk viral transmission is not prevented by restricting daily volume.\n- E. Permissible if VL <50: While supported breastfeeding with monthly monitoring is permitted if a mother insists, the primary standard recommendation in UK/BHIVA guidelines remains that breastfeeding is not recommended.",
    highlightedHtml: ""
  },
  {
    id: "swe_q12",
    text: "A 20-year-old man presents with persistent diarrhea and abdominal bloating after returning from a gap year in Africa and is diagnosed with strongyloidiasis. How did the Strongyloides stercoralis organism initially enter his body?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Sexual transmission",
      B: "Faecal-oral route",
      C: "Penetrated the skin",
      D: "Respiratory droplet route",
      E: "Mosquito vector"
    },
    correctOption: "C",
    explanation: "Strongyloides stercoralis Transmission: Infectious filariform larvae in contaminated soil actively penetrate intact human skin (typically through barefoot walking).\nLife Cycle & Autoinfection: Larvae migrate via the bloodstream to the lungs, are coughed up and swallowed, and mature into adults in the small intestine. Uniquely, rhabditiform larvae in the gut can transform into filariform larvae causing perianal or internal autoinfection, which can lead to life-threatening hyperinfection syndrome in immunocompromised patients.\nOption Analysis:\n- A. Sexual transmission: Mode of spread for STIs and enteric pathogens via oral-anal contact (Shigella, Giardia).\n- B. Faecal-oral route: Route for ingested parasites such as Ascaris lumbricoides, Trichuris trichiura, and Entamoeba histolytica.\n- D. Respiratory droplet route: Route for respiratory/airborne pathogens (Mycobacterium tuberculosis, Influenza).\n- E. Mosquito vector: Vector route for blood parasites such as Plasmodium spp. (Malaria) and Wuchereria bancrofti (Filariasis).",
    highlightedHtml: ""
  },
  {
    id: "swe_q13",
    text: "What is the first-line treatment in hydatid disease?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Metronidazole",
      B: "Ciprofloxacin",
      C: "Itraconazole",
      D: "Albendazole",
      E: "Sodium stibogluconate"
    },
    correctOption: "D",
    explanation: "Albendazole: The primary anthelmintic agent (benzimidazole derivative) used for the medical management of hydatid disease (Echinococcus granulosus). It acts by inhibiting microtubule assembly in the parasite, impairing glucose absorption and leading to glycogen depletion.\nClinical Indications: Used as medical monotherapy for small/inoperable hydatid cysts, as perioperative prophylaxis (pre- and post-surgery) to prevent secondary scolicidal seeding during excision, or in conjunction with the PAIR technique (Percutaneous Aspiration, Injection, Re-aspiration).\nOption Analysis:\n- A. Metronidazole: Anti-protozoal and anti-anaerobic agent used primarily for Entamoeba histolytica, Giardia lamblia, and Trichomonas vaginalis.\n- B. Ciprofloxacin: Fluoroquinolone antibiotic used for invasive bacterial bowel infections such as Shigella dysentery.\n- C. Itraconazole: Triazole antifungal agent used for systemic and endemic fungal infections.\n- E. Sodium stibogluconate: Pentavalent antimonial compound used as first-line therapy for visceral and cutaneous leishmaniasis.",
    highlightedHtml: ""
  },
  {
    id: "swe_q14",
    text: "Which of the following is NOT a direct cysticidal drug in luminal amoebiasis?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Tetracycline",
      B: "Diloxanide furoate",
      C: "Chloroquine (Otloroquine)",
      D: "Paromomycin"
    },
    correctOption: "A",
    explanation: "Mechanism of Tetracycline: Tetracycline is an indirect luminal amoebicide. It does not exert direct cidal activity against Entamoeba histolytica cysts or trophozoites; instead, it inhibits enteric bacterial flora necessary for amoebic survival in the bowel lumen.\nDirect Luminal Cysticidal Agents: Diloxanide furoate and Paromomycin (and Iodoquinol) act directly on luminal forms to destroy cysts and eradicate intestinal colonization.\nOption Analysis:\n- A. Tetracycline (Model Answer): Indirect luminal agent; lacks direct cysticidal activity.\n- B. Diloxanide furoate: Direct luminal cysticidal drug used for asymptomatic cyst carriers.\n- C. Chloroquine (Otloroquine): Tissue amoebicide specific for hepatic amebiasis.\n- D. Paromomycin: Direct luminal aminoglycoside that directly destroys luminal cysts.",
    highlightedHtml: ""
  },
  {
    id: "swe_q15",
    text: "A 28-year-old resident physician sustains a deep percutaneous puncture injury from a large-bore hollow needle visibly contaminated with blood while attempting an arterial line insertion on a patient with end-stage AIDS (high viral load, CD4 count 45 cells/µL). The resident washes the wound immediately with soap and water. What is the most appropriate management regarding HIV Post-Exposure Prophylaxis (PEP)?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Reassure the resident as the transmission risk from percutaneous needle stick is <0.03%",
      B: "Initiate a 2-drug antiretroviral PEP regimen within 24 hours and continue for 14 days",
      C: "Initiate a 3-drug antiretroviral PEP regimen (Tenofovir + Emtricitabine + Dolutegravir) ideally within 1–2 hours (up to 72 hours) for 28 days",
      D: "Administer intravenous zidovudine immediately and repeat baseline HIV ELISA test at 6 months only",
      E: "Delay PEP initiation until Western Blot confirmation of the source patient's HIV viral load"
    },
    correctOption: "C",
    explanation: "According to WHO/CDC guidelines and the Infectious Diseases protocol, a deep percutaneous injury with a large-bore needle from a high-risk source (Source Code 2 / Exposure Code 3) requires immediate 3-drug HIV PEP. The optimal window for initiation is within 1–2 hours, though it can be started up to 72 hours post-exposure. PEP is strictly administered for 28 days. Standard preferred 3-drug regimens consist of 2 NRTIs (Tenofovir + Emtricitabine) plus an Integrase Inhibitor (Dolutegravir or Raltegravir) or a boosted Protease Inhibitor.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: The baseline transmission risk of HIV via percutaneous needle stick is ~0.3% (not <0.03%, which applies to mucous membrane exposure).\n- B is incorrect: Modern HIV PEP requires a 3-drug regimen for 28 days (not 2 drugs for 14 days).\n- C is CORRECT: Immediate initiation of 3-drug PEP within 1-2 hours up to 72 hours for 28 days is the gold standard protocol.\n- D is incorrect: IV zidovudine is used in maternal-fetal intrapartum transmission, not occupational PEP. Baseline testing occurs at 0, 1, and 3 months.\n- E is incorrect: PEP must NEVER be delayed waiting for lab confirmation when dealing with a high-risk source.",
    highlightedHtml: ""
  },
  {
    id: "swe_q16",
    text: "A phlebotomist completed a 28-day PEP course following a needle-stick injury from an HIV-positive source. According to standard infection control protocols, what is the required baseline and follow-up HIV antibody/antigen testing schedule for the exposed healthcare worker?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Baseline (0), 2 weeks, and 6 weeks",
      B: "Baseline (0), 1 month (4 weeks), and 3 months (12 weeks)",
      C: "Baseline (0) and 1 year only",
      D: "1 month and 6 months only",
      E: "Baseline (0) and 14 days post-exposure"
    },
    correctOption: "B",
    explanation: "The standard post-exposure testing protocol for healthcare workers exposed to HIV requires baseline testing (0 time) to ensure the worker was not previously HIV-positive, followed by repeat testing at 1 month (4 weeks) and 3 months (12 weeks) post-exposure. Fourth-generation HIV Ag/Ab combination immunoassays allow reliable exclusion of seroconversion within this 3-month window.\nOption Analysis & Differential Diagnosis:\n- A, C, D, E are incorrect: Testing at 0, 1, and 3 months is the standard protocol to verify seronegativity following occupational PEP.",
    highlightedHtml: ""
  },
  {
    id: "swe_q17",
    text: "A public health physician is evaluating rabies vaccine formulations. Which rabies vaccine formulation is historically associated with severe post-vaccination demyelinating allergic encephalomyelitis, and why is gluteal administration strictly forbidden for modern cell-culture vaccines?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Human Diploid Cell Vaccine (HDCV); gluteal injection causes severe sciatic nerve palsy",
      B: "Nervous tissue (Semple) vaccine; gluteal injection results in significantly lower antibody titers and treatment failure",
      C: "Purified Chick Embryo Cell Vaccine (PCECV); gluteal injection causes gluteal fat necrosis",
      D: "Recombinant protein vaccine; gluteal injection induces systemic anaphylaxis",
      E: "Live attenuated rabies vaccine; gluteal injection causes local muscle abscesses"
    },
    correctOption: "B",
    explanation: "Nervous tissue-derived (Semple) rabies vaccines contain myelin basic protein, which triggers rare but devastating allergic demyelinating encephalomyelitis. Modern rabies vaccines (HDCV, PCECV) are cell-culture derived and safe. Modern rabies vaccines must NEVER be injected into the gluteal region because deep adipose tissue in the buttocks impairs antigen presentation, resulting in significantly lower neutralizing antibody titers and documented vaccine failure. The preferred sites are the deltoid muscle in adults and anterolateral thigh in young children.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: HDCV is a cell-culture vaccine with 100% efficacy and minimal adverse reactions.\n- B is CORRECT: Semple vaccine causes demyelinating encephalomyelitis; gluteal injection reduces antibody response and leads to treatment failure.\n- C, D, E are incorrect: Gluteal fat absorption (not fat necrosis or abscess) is the specific physiological mechanism causing sub-therapeutic titers.",
    highlightedHtml: ""
  },
  {
    id: "swe_q18",
    text: "A 55-year-old female on chronic outpatient hemodialysis three times weekly via an arteriovenous fistula presents to the emergency department with fever, chest pain, and productive cough. Chest X-ray confirms a right lower lobe consolidation. Which organism represents the most prominent pathogen responsible for healthcare-associated pulmonary and intravascular infections in chronic hemodialysis patients?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Mycoplasma pneumoniae",
      B: "Methicillin-Resistant Staphylococcus aureus (MRSA)",
      C: "Streptococcus pneumoniae",
      D: "Haemophilus influenzae type b",
      E: "Legionella pneumophila"
    },
    correctOption: "B",
    explanation: "Patients undergoing chronic outpatient hemodialysis face exceptionally high risks of colonization and invasive infection with Methicillin-Resistant Staphylococcus aureus (MRSA) and multidrug-resistant Gram-negative bacilli. Repeated vascular cannulation, central venous catheters, frequent contact with healthcare settings, and altered cutaneous immune barriers make MRSA a leading cause of both HCAP and catheter-related bloodstream infections in this population.\nOption Analysis & Differential Diagnosis:\n- A, C, D are incorrect: These are typical pathogens responsible for Community-Acquired Pneumonia (CAP) in non-dialysis outpatient populations.\n- B is CORRECT: MRSA is the primary pathogen implicated in HCAP and vascular infections among chronic hemodialysis patients.\n- E is incorrect: Legionella is associated with contaminated water supply systems and AC cooling towers.",
    highlightedHtml: ""
  },
  {
    id: "swe_q19",
    text: "An infection control committee is analyzing hospital-wide microbiological surveillance data. Which group of microorganisms represents the characteristic profile of Hospital-Acquired Infections (HAIs) compared to Community-Acquired Infections (CAIs)?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Streptococcus pneumoniae, Haemophilus influenzae, and Hepatitis A virus",
      B: "Clostridioides difficile, MRSA, Vancomycin-Resistant Enterococci (VRE), Pseudomonas aeruginosa, and Candida species",
      C: "Borrelia burgdorferi, Legionella pneumophila, and EBV",
      D: "Salmonella enteritidis, Shigella sonnei, and Rotavirus",
      E: "Mycoplasma pneumoniae, Chlamydia pneumoniae, and Influenza A"
    },
    correctOption: "B",
    explanation: "The microbiological spectrum of Hospital-Acquired Infections (HAIs) is dominated by multidrug-resistant (MDR) nosocomial pathogens, opportunistic fungi, and toxin-producing anaerobes, specifically: Clostridioides difficile, MRSA, VRE, Pseudomonas aeruginosa, Acinetobacter baumannii, ESBL-producing Enterobacterales, and Candida species. In contrast, CAIs are typically caused by wild-type, susceptible pathogens like Streptococcus pneumoniae, H. influenzae, HAV, and community respiratory viruses.\nOption Analysis & Differential Diagnosis:\n- A, C, D, E are incorrect: These comprise classic community-acquired bacterial, viral, and zoonotic pathogens.\n- B is CORRECT: C. difficile, MRSA, VRE, Pseudomonas, and Candida represent the core nosocomial MDR threat matrix.",
    highlightedHtml: ""
  },
  {
    id: "swe_q20",
    text: "A bedridden elderly patient in a medical ward develops a high fever, suprapubic pain, and cloudy, foul-smelling urine 3 days after urinary catheter insertion. Epidemiological investigation reveals that a nurse manipulated the urinary drainage bag tubing of an adjacent patient with Pseudomonas CAUTI immediately before adjusting this patient's catheter without performing hand hygiene. What is the fundamental epidemiological mechanism of this infection?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Endogenous autoinfection from the patient's normal colonic flora",
      B: "Exogenous hospital-acquired cross-transmission via contaminated healthcare worker hands",
      C: "Hematogenous seeding from a primary respiratory tract infection",
      D: "Normal commensal urethral colonization requiring no intervention",
      E: "Airborne droplet transmission within the ward"
    },
    correctOption: "B",
    explanation: "This clinical scenario demonstrates classic exogenous hospital-acquired (nosocomial) cross-transmission. Healthcare workers' hands serve as the primary vector transferring transient multidrug-resistant pathogens (such as Pseudomonas aeruginosa) between hospitalized patients when hand hygiene is omitted between contacts. Infections developing ≥48 hours after admission linked to invasive instrumentation (like urinary catheters) are classified as HAIs.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: While endogenous flora causes some CAUTIs, the direct temporal link to unwashed hands manipulating an adjacent patient's catheter confirms exogenous transmission.\n- B is CORRECT: Exogenous cross-transmission via contaminated healthcare worker hands is the leading cause of HAIs.\n- C, D, E are incorrect: CAUTI is an ascending catheter-associated urinary infection, not hematogenous or airborne.",
    highlightedHtml: ""
  },
  {
    id: "swe_q21",
    text: "A nurse enters the room of a patient with confirmed Clostridioides difficile colitis who has severe watery diarrhea. After examining the patient and removing non-sterile gloves, which hand hygiene method MUST be performed, and what is the pathophysiological rationale?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "70% Ethyl alcohol-based hand rub for 15 seconds, because alcohol dissolves bacterial cell walls",
      B: "Mechanical washing with plain soap and running water for at least 20 seconds, because C. difficile endospores are intrinsically resistant to alcohol-based rubs",
      C: "Rinsing hands with sterile saline alone without soap",
      D: "Chlorhexidine surgical scrub for 5 minutes",
      E: "Alcohol rub followed immediately by wearing fresh gloves without washing"
    },
    correctOption: "B",
    explanation: "Clostridioides difficile produces dormant, metabolic-resistant bacterial endospores coated with thick protein coats that render them intrinsically immune to destruction by alcohol-based hand rubs. Consequently, alcohol rubs fail to eradicate spores from contaminated hands. Infection control guidelines strictly mandate physical hand washing with soap, running water, and vigorous mechanical friction for at least 20 seconds to physically wash and rinse the endospores off the skin surface.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: Alcohol rubs do NOT kill C. difficile endospores and leave them viable on hands.\n- B is CORRECT: Mechanical friction with soap and running water physically removes alcohol-resistant spores.\n- C is incorrect: Saline lacks surfactants needed to suspend bacterial spores.\n- D is incorrect: Antiseptic scrubs without mechanical rinsing do not remove spores effectively.\n- E is incorrect: Gloves must be removed and hands washed with soap and water.",
    highlightedHtml: ""
  },
  {
    id: "swe_q22",
    text: "A hospital infection control committee is reviewing isolation precautions. A patient with suspected Neisseria meningitidis bacterial meningitis requires Droplet Precautions, while a patient with active Pulmonary Tuberculosis requires Airborne Isolation. Which set of isolation engineering and PPE requirements correctly differentiates Droplet from Airborne precautions?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Droplet: Negative-pressure room + N95 respirator; Airborne: Standard room + surgical mask",
      B: "Droplet: Standard private room, surgical mask when working within 1–2 meters, droplets >5 µm that fall rapidly; Airborne: Negative-Pressure Airborne Infection Isolation Room (AIIR), fitted N95 respirator, droplet nuclei <5 µm that remain suspended in air",
      C: "Droplet: Positive-pressure room + HEPA filter; Airborne: Open ward + gloves only",
      D: "Droplet and Airborne precautions have identical PPE and room requirements",
      E: "Droplet: Full Tyvek suit + positive pressure hood; Airborne: Surgical gown + face shield"
    },
    correctOption: "B",
    explanation: "Droplet transmission involves large respiratory droplets (>5 µm in diameter) generated during coughing or sneezing that travel short distances (<1–2 meters) and fall rapidly to the ground; management requires a standard private isolation room and a surgical mask. Airborne transmission involves tiny droplet nuclei (<5 µm in diameter) that remain suspended in air currents for extended periods and travel long distances; management strictly requires a Negative-Pressure Airborne Infection Isolation Room (AIIR with ≥12 air changes/hour vented to the outside) and a fitted N95/FFP3 respirator mask.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: Reverses the isolation room pressure and mask requirements.\n- B is CORRECT: Accurately differentiates particle size (>5 µm vs <5 µm), air behavior, room pressure (standard vs negative AIIR), and mask type (surgical vs N95).\n- C is incorrect: Positive-pressure rooms are for protective neutropenic isolation, not infectious droplet cases.\n- D & E are incorrect: Conflate isolation categories.",
    highlightedHtml: ""
  },
  {
    id: "swe_q23",
    text: "A 6-year-old unimmunized child presents with fever, cough, coryza, and conjunctivitis. Examination of his oral cavity reveals small, irregular, bluish-white spots on a background of bright red buccal mucosa opposite the lower molars. Two days later, a maculopapular rash appears starting at the hairline. In a second patient with a 10-day history of step-ladder fever, faint 2–4 mm salmon-pink blanching macules appear on the upper abdomen. What are these two distinct cutaneous/mucosal markers called?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Koplik spots (Measles) and Rose spots (Typhoid fever)",
      B: "Forchheimer spots (Rubella) and Janeway lesions (Endocarditis)",
      C: "Pastia lines (Scarlet fever) and Osler nodes (Endocarditis)",
      D: "Nagayama spots (Roseola) and Koplik spots (Chickenpox)",
      E: "Koplik spots (Mumps) and Slapped cheeks (Parvovirus)"
    },
    correctOption: "A",
    explanation: "Key pathognomonic mucosal and cutaneous lesions: 1) Koplik spots: Pathognomonic enanthem of Measles (Rubeola virus). They are bluish-white pinpoint papules on an erythematous base on the buccal mucosa opposite the lower second molars, appearing 24–48 hours BEFORE the characteristic maculopapular exanthem. 2) Rose spots: Pathognomonic exanthem of Typhoid fever (Salmonella typhi). Faint, transient, blanching salmon-pink macules (2–4 mm) appearing on the anterior abdomen and lower chest during the second week of fever, caused by localized bacterial embolization.\nOption Analysis & Differential Diagnosis:\n- A is CORRECT: Accurately identifies Koplik spots (Measles enanthem) and Rose spots (Salmonella typhi exanthem).\n- B is incorrect: Forchheimer spots are soft palate petechiae in Rubella; Janeway lesions are non-tender macules in IE.\n- C is incorrect: Pastia lines occur in skin folds in Scarlet fever; Osler nodes are tender digital nodules in IE.",
    highlightedHtml: ""
  },
  {
    id: "swe_q24",
    text: "During a viral respiratory epidemic, an otherwise healthy 18-year-old adolescent presents with painful, pruritic, purplish-red erythematous-edematous papules and plaques on his toes and lateral feet soles resembling chilblains (pernio). He has no history of cold exposure. Nasopharyngeal PCR confirms SARS-CoV-2 infection. What is the clinical term for this cutaneous manifestation?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Erythema Migrans",
      B: "Pseudo-Chilblains (COVID Toes / Acral Erythema)",
      C: "Ecthyma Gangrenosum",
      D: "Janeway Lesions",
      E: "Osler Nodes"
    },
    correctOption: "B",
    explanation: "Pseudo-chilblains (popularly termed \"COVID Toes\" or Acral Erythema/Edema) is a recognized cutaneous manifestation of COVID-19 (SARS-CoV-2). It manifests as painful or pruritic, erythematous-purpuric macules, papules, or swelling on the toes and fingers, mimicking cold-induced chilblains (pernio) but occurring in the absence of cold exposure. It is predominantly seen in adolescents and young adults with mild or asymptomatic COVID-19, driven by an robust innate type I interferon response and microvascular lymphocytic vasculitis.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: Erythema Migrans is the expanding annular rash of Lyme disease (Borrelia burgdorferi).\n- B is CORRECT: Pseudo-chilblains (COVID Toes) is the characteristic acral microvascular rash of SARS-CoV-2.\n- C is incorrect: Ecthyma gangrenosum is necrotic Pseudomonas ulcers.\n- D & E are incorrect: Embolic markers of infective endocarditis.",
    highlightedHtml: ""
  },
  {
    id: "swe_q25",
    text: "A 32-year-old agricultural worker in Sudan presents with prolonged irregular fever featuring a double daily spike (saddle-shaped curve), marked weight loss, dark gray hyperpigmentation of the skin, and massive splenomegaly extending to the pelvic rim. Complete blood count reveals pancytopenia (Hb 6.2 g/dL, WBC 1,800/µL, Platelets 45,000/µL) and severe polyclonal hypergammaglobulinemia. Bone marrow aspirate Giemsa stain confirms intracellular amastigotes within macrophages. Eight months after successful treatment, he develops hypopigmented macules and nodular lesions on his face and trunk. What is the parasite, diagnostic stage, and post-treatment cutaneous complication?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Trypanosoma brucei; Trypomastigote; Winterbottom sign",
      B: "Leishmania donovani; Amastigote (Leishman-Donovan bodies); Post-Kala-Azar Dermal Leishmaniasis (PKDL)",
      C: "Entamoeba histolytica; Trophozoite; Amoeboma",
      D: "Toxoplasma gondii; Tachyzoite; Chorioretinitis",
      E: "Plasmodium falciparum; Schizont; Blackwater fever"
    },
    correctOption: "B",
    explanation: "Visceral Leishmaniasis (Kala-azar, \"black fever\") is caused by Leishmania donovani / L. infantum transmitted by female sandflies (Phlebotomus). Diagnostic stage: Intracellular Amastigotes (Leishman-Donovan bodies) inside mononuclear phagocytes/macrophages on Giemsa-stained bone marrow or splenic aspirates. Clinical hallmarks: Double daily spiking fever, massive splenomegaly, pancytopenia (due to hypersplenism and BM suppression), hypergammaglobulinemia, and dark gray skin discoloration. Post-Kala-Azar Dermal Leishmaniasis (PKDL) is a cutaneous complication appearing 6–12 months after treatment of visceral leishmaniasis, presenting as macular, papular, or nodular facial/trunk rashes due to a persistent immune reaction to residual parasite antigens.\nOption Analysis & Differential Diagnosis:\n- A is incorrect: T. brucei causes sleeping sickness with Winterbottom sign (posterior cervical lymphadenopathy).\n- B is CORRECT: L. donovani causes Kala-azar (amastigote diagnostic stage) and post-treatment PKDL.\n- C is incorrect: E. histolytica causes amebic liver abscess and dysentery.\n- D is incorrect: Toxoplasma tachyzoites cause chorioretinitis in congenital/immunosuppressed hosts.\n- E is incorrect: P. falciparum causes Blackwater fever.",
    highlightedHtml: ""
  },
  {
    id: "swe_q26",
    text: "A 30-year-old traveler develops high fever, chills, urticaria, dry cough, abdominal pain, hepatosplenomegaly, and striking eosinophilia (35%) 4 weeks after swimming in Lake Malawi (Katayama Syndrome). A chronic schistosomiasis patient from Egypt with long-standing Schistosoma haematobium infection presents with painless total hematuria. Cystoscopy reveals bladder wall calcifications. What are the immunopathological mechanisms driving Katayama syndrome and S. haematobium bladder malignancy?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Katayama syndrome is an acute immune-complex reaction (serum sickness-like) to migrating schistosomula and egg deposition; S. haematobium chronic egg deposition induces chronic inflammation and squamous cell carcinoma of the urinary bladder",
      B: "Katayama syndrome is direct bacterial endotoxemia; S. haematobium causes renal cell adenocarcinoma",
      C: "Katayama syndrome is type IV delayed hypersensitivity; S. haematobium causes transitional cell carcinoma",
      D: "Katayama syndrome is IgE-mediated anaphylaxis; S. haematobium causes Wilms tumor",
      E: "Katayama syndrome is viral co-infection; S. haematobium causes prostatic sarcoma"
    },
    correctOption: "A",
    explanation: "Schistosomiasis disease spectrum: 1) Katayama Syndrome (Acute Toxemic Schistosomiasis): A systemic serum sickness-like immune-complex reaction (Type III/Type I hypersensitivity) occurring 2–8 weeks post-exposure as migrating schistosomula mature into adults and begin egg oviposition. Manifests as fever, chills, urticaria, cough, lymphadenopathy, hepatosplenomegaly, and marked eosinophilia (frequent with S. japonicum & S. mansoni). 2) Chronic Schistosoma haematobium Infection: Adult worms inhabit the vesical venous plexus. Terminal spined eggs trapped in the bladder wall trigger chronic granulomatous inflammation, fibrotic calcification (\"sandy patches\"), and carry a strong, direct carcinogenic risk for Squamous Cell Carcinoma (SCC) of the urinary bladder (NOT transitional cell carcinoma).\nOption Analysis & Differential Diagnosis:\n- A is CORRECT: Accurately identifies Katayama syndrome (immune-complex serum sickness) and S. haematobium-induced Squamous Cell Carcinoma of the bladder.\n- B, C, D, E are incorrect: Misidentify the specific cancer type (S. haematobium specifically causes Squamous Cell Carcinoma, not renal cell or transitional cell carcinoma).",
    highlightedHtml: ""
  },
  {
    id: "swe_q27",
    text: "A 6-year-old boy is brought to the pediatric clinic by his mother due to a 3-week history of marked nocturnal restlessness, difficulty sleeping, and recent onset of secondary bed-wetting (enuresis). Daytime abdominal examination is completely unremarkable with no tenderness or organomegaly. On further questioning, his mother reports that he frequently scratches his bottom at night. Late last evening, while inspecting his perianal area with a flashlight during sleep, she noticed a tiny, motile, white thread-like worm emerging from his anal orifice. What is the most appropriate first-line medical management plan for this patient?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Metronidazole (single oral dose)",
      B: "Praziquantel (single oral dose)",
      C: "Albendazole (single oral dose, repeated after 2 weeks)",
      D: "Ivermectin (single oral dose)",
      E: "Permethrin 5% topical cream"
    },
    correctOption: "C",
    explanation: "Enterobius vermicularis (Pinworm / Threadworm): A widespread intestinal nematode colonizing the caecum and appendix.\nPathophysiology & Presentation: Gravid female worms migrate out of the anus at night to deposit sticky eggs on the perianal skin, causing intense nocturnal pruritus ani, irritability, sleep disruption, and secondary enuresis. The key diagnostic finding is direct visualization of small white female adult worms in the perianal area or stool.\nTreatment Protocol: Albendazole (or Mebendazole) is the first-line anti-helminthic drug. A second dose given 2 weeks later is essential because the drug kills adult worms but is ineffective against eggs; repeating therapy eradicates newly hatched adult worms before they mature and lay new eggs, preventing autoinfection and retroinfection. Note: Simultaneous treatment of all household contacts and strict personal/linen hygiene measures are required.",
    highlightedHtml: ""
  },
  {
    id: "swe_q28",
    text: "A 35-year-old fisherman from the Philippines presents with a 2-month history of progressive watery diarrhea, recurrent vomiting, marked weight loss, and bilateral lower limb edema. Laboratory findings reveal severe hypoproteinemia and hypoalbuminemia with electrolyte depletion. Small bowel biopsy demonstrates mucosal inflammation and villous atrophy, while stool microscopy shows characteristic peanut-shaped eggs with flattened bipolar plugs. What is the most appropriate first-line anthelmintic treatment?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Metronidazole for 7 days",
      B: "Albendazole for 10 days",
      C: "Praziquantel single dose",
      D: "Ivermectin single dose",
      E: "Diethylcarbamazine for 14 days"
    },
    correctOption: "B",
    explanation: "Capillaria philippinensis: Intestinal nematode acquired by ingesting raw freshwater fish.\nPathogenesis & Features: Causes chronic inflammation of intestinal mucosa and villous atrophy, leading to severe protein-losing enteropathy, malabsorption, hypoproteinemia, lower limb edema, and severe dehydration.\nTreatment: Prolonged anthelmintic therapy with Albendazole (10 days) or Mebendazole (28 days) is required to clear adult worms and prevent autoinfection.\nOption Analysis:\n- A. Metronidazole: Anti-protozoal agent (Giardia, Entamoeba); inactive against intestinal nematodes.\n- C. Praziquantel: Drug of choice for trematodes (Schistosoma) and cestodes; ineffective for Capillaria.\n- D. Ivermectin: First-line for Strongyloides stercoralis, not the primary regimen for Capillaria.\n- E. Diethylcarbamazine: Used for lymphatic filariasis (Wuchereria bancrofti).",
    highlightedHtml: ""
  },
  {
    id: "swe_q29",
    text: "A mother brings her infant daughter to the primary healthcare center for a routine developmental checkup. Review of the child's official WHO Expanded Programme for Immunization (EPI) card reveals the following records:\nA well-healed BCG scar is visible on the left shoulder.\nShe has completed three doses of the Pentavalent vaccine (DPT in the left thigh, Hepatitis B & Hib in the right thigh) along with three routine doses of oral poliovirus vaccine (OPV) given at 2-month intervals.\nAt her most recent clinic visit, she received oral Sabin (OPV) drops and one oral capsule of Vitamin A.\nShe has no history of receiving any subcutaneous injections in her right arm to date.\nBased on the EPI schedule, what is the most likely current age category of this child?",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "4 to 5 months",
      B: "7 to 8 months",
      C: "10 to 11 months",
      D: "13 to 14 months",
      E: "19 to 20 months"
    },
    correctOption: "C",
    explanation: "EPI Schedule Milestones:\n1. Birth: BCG (left shoulder), Hep B (right thigh), OPV (zero dose).\n2. 2, 4, 6 Months: Pentavalent doses 1, 2, 3 (DPT left thigh + Hep B/Hib right thigh) + OPV.\n3. 9 Months: OPV dose + 1 capsule of Vitamin A (No subcutaneous injections given at 9 months).\n4. 12 Months: First dose of MMR (0.5 ml SC in the right arm) + OPV.\nAge Deduction: The presence of the 9-month milestone markers (OPV + 1 Vitamin A capsule) combined with the absolute absence of any subcutaneous right-arm injection (MMR, which is scheduled at 12 months) confirms the child has passed 9 months but has not yet reached 12 months of age (10 to 11 months).",
    highlightedHtml: ""
  },
  {
    id: "swe_q30",
    text: "A 28-year-old pregnant woman at 14 weeks gestation attends her routine antenatal clinic for an immunization review. She is planning international travel later in her pregnancy and inquires about updating her routine and recommended vaccines.\nAll of the following vaccines can be safely administered during pregnancy when indicated EXCEPT:",
    notes: "",
    marked: false,
    status: "unused",
    options: {
      A: "Inactivated Influenza vaccine",
      B: "Tdap (Tetanus, Diphtheria, Acellular Pertussis)",
      C: "Recombinant Hepatitis B vaccine",
      D: "MMR (Measles, Mumps, Rubella) vaccine",
      E: "Meningococcal conjugate vaccine"
    },
    correctOption: "D",
    explanation: "Live Vaccines Contraindicated: Live attenuated vaccines (such as MMR, Varicella, Live Attenuated Influenza Nasal Spray, Zoster, and BCG) carry a theoretical risk of fetal infection and vertical transmission. They are strictly contraindicated during pregnancy. Women receiving MMR should be advised to avoid pregnancy for at least 4 weeks post-vaccination.\nInactivated Vaccines Safe: Non-live (inactivated, toxoid, recombinant) vaccines carry no risk of fetal infection and can be safely administered when indicated (e.g., Inactivated Flu during flu season, Tdap at 27–36 weeks gestation).\nOption Analysis:\n- A. Inactivated Influenza: Recommended for all pregnant women during flu season regardless of trimester.\n- B. Tdap: Routinely administered in each pregnancy (preferably 27–36 weeks) to pass protective passive IgG antibodies to the fetus against pertussis.\n- C & E (Hepatitis B & Meningococcal): Inactivated/subunit vaccines safe to give during pregnancy if the mother is at high risk of exposure.\n- D (Model Answer): Live attenuated vaccine; strictly contraindicated due to potential fetal infection risk.",
    highlightedHtml: ""
  }
];

const reportData = {
  id: "task_six_week_exam",
  group_name: "infection",
  title: "six week exam",
  time_limit: 30,
  date_created: new Date().toISOString(),
  question_ids: questions
};

fs.writeFileSync('report9_six_week_exam.json', JSON.stringify(reportData, null, 2), 'utf8');
console.log(`Successfully generated report9_six_week_exam.json with ${questions.length} questions!`);
