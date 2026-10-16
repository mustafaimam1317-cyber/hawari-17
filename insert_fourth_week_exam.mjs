import fs from 'node:fs';

const SUPABASE_URL = 'https://sueksolsletlhunpbtix.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c';

const questions = [
  {
    id: "inf_w4_q01",
    text: "Which of the following agent is used to prevent Malaria?",
    options: [
      "Mebendazole",
      "Chloroquine",
      "Inactivated vaccine",
      "Zinc table"
    ],
    correctOption: "B",
    explanation: "Chloroquine is a 4-aminoquinoline used for chemoprophylaxis against malaria in areas with chloroquine-sensitive Plasmodium strains (administered at a dose of 300 mg weekly, started 1–2 weeks before travel and continued for 4 weeks after returning).\n\nRule-Outs: Mebendazole is an antihelminthic; Zinc is an essential micronutrient used in diarrhea; standard inactivated vaccines are not used for malaria prophylaxis."
  },
  {
    id: "inf_w4_q02",
    text: "Vivax malaria:",
    options: [
      "May be complicated by anaemia",
      "May be complicated by jaundice",
      "In a traveller may present more than six months after exposure",
      "Is sensitive to chloroquine",
      "All of the above"
    ],
    correctOption: "E",
    explanation: "Option A & B: Intravascular and extravascular hemolysis of infected erythrocytes occurs in all forms of malaria, leading to mild anemia and unconjugated hyperbilirubinemia (jaundice).\n\nOption C: Plasmodium vivax forms dormant liver stages (hypnozoites) that can remain latent for months to years, causing delayed primary presentations or relapses long after returning from an endemic region.\n\nOption D: P. vivax generally remains sensitive to standard Chloroquine therapy (combined with Primaquine for radical cure of hypnozoites)."
  },
  {
    id: "inf_w4_q03",
    text: "Quinine:",
    options: [
      "Is active against schizonts of Plasmodium malariae",
      "Resistance occurs in Plasmodium falciparum in South East Asia",
      "Cerebrospinal fluid levels are much lower than serum levels following oral or intravenous administration",
      "Causes hypoglycaemia",
      "All of the above"
    ],
    correctOption: "E",
    explanation: "Option A: Quinine is a potent blood schizonticide active against erythrocytic stages of all four human Plasmodium species, including P. malariae.\n\nOption B: Quinine-resistant P. falciparum strains have been well documented in Southeast Asia.\n\nOption C: Quinine penetrates the blood-brain barrier poorly; CSF concentrations are only 2% to 5% of corresponding serum levels.\n\nOption D: Quinine directly stimulates pancreatic beta-cells to secrete insulin, frequently precipitating severe hyperinsulinemic hypoglycemia."
  },
  {
    id: "inf_w4_q04",
    text: "Malarial parasite is best obtained from a patient:",
    options: [
      "An hour after rise of temperature",
      "While temperature is rising sharply",
      "After 24 hours when temperature is normal",
      "After temperature becomes normal"
    ],
    correctOption: "B",
    explanation: "Diagnostic thick and thin blood films are best collected while the patient's body temperature is rising sharply (during the cold/shivering stage or early hot stage). This timing coincides with the rupture of mature erythrocytic schizonts and peak release of merozoites into the circulating bloodstream."
  },
  {
    id: "inf_w4_q05",
    text: "Vaccination in malaria has not been successful because:",
    options: [
      "Plasmodium produces antitoxins",
      "Plasmodium produces minute bodies",
      "It does not produce antibodies and antitoxins",
      "None of the above"
    ],
    correctOption: "C",
    explanation: "Traditional whole-killed or inactivated vaccines fail because natural Plasmodium infection involves rapid multi-stage antigenic variation and intracellular hiding stages (hepatocytes and RBCs) that do not elicit sustained protective neutralizing antibodies or antitoxins without targeted recombinant sporozoite protein vaccines (e.g., Mosquirix / RTS,S)."
  },
  {
    id: "inf_w4_q06",
    text: "Mosquitoes are the vector in the following disorders:",
    options: [
      "Onchocerciasis",
      "Visceral leishmaniasis",
      "Myiasis",
      "African trypanosomiasis",
      "Bancroftian filariasis"
    ],
    correctOption: "E",
    explanation: "Mosquito Vector: Wuchereria bancrofti (Bancroftian filariasis) is transmitted to humans by mosquito vectors (primarily Culex quinquefasciatus in urban areas, and Anopheles or Aedes in rural regions).\n\nRule-Outs: Onchocerciasis is transmitted by blackflies (Simulium); Leishmaniasis by sandflies (Phlebotomus/Lutzomyia); African trypanosomiasis by tsetse flies (Glossina)."
  },
  {
    id: "inf_w4_q07",
    text: "Quinine:",
    options: [
      "Is gametocidal for mature gametocytes of Plasmodium falciparum",
      "Is not active against schizonts of Plasmodium malariae",
      "Cerebrospinal fluid levels are much lower than serum levels following oral or intravenous administration",
      "Causes hyperglycaemia"
    ],
    correctOption: "C",
    explanation: "Pharmacokinetics: Quinine poorly crosses the blood-brain barrier; CSF concentrations reach only 2% to 5% of corresponding serum concentrations.\n\nRule-Outs: Quinine is NOT gametocidal for mature P. falciparum gametocytes (Primaquine is required); it IS active against erythrocytic schizonts of P. malariae; and it causes HYPOglycemia (due to pancreatic beta-cell stimulation) rather than hyperglycemia."
  },
  {
    id: "inf_w4_q08",
    text: "Typical features of tropical splenomegaly syndrome are:",
    options: [
      "Very low or absent malarial antibody titres",
      "Increased serum IgG",
      "Lymphocytic infiltration of hepatic sinusoids",
      "Plasmodium falciparum parasitaemia"
    ],
    correctOption: "C",
    explanation: "Histopathological Hallmark: The defining pathological feature of Hyperreactive Malarial Splenomegaly (Tropical Splenomegaly Syndrome) is marked lymphocytic infiltration of the hepatic sinusoids (hepatic sinusoidal lymphocytosis) alongside Kupffer cell hyperplasia."
  },
  {
    id: "inf_w4_q09",
    text: "A 24-year-old man is admitted to the Emergency Department with breathing difficulties and confusion three weeks after returning from a holiday in Cambodia. His partner reports that he has had flu-like symptoms for the past two weeks. A blood film is positive for malarial parasites, and chest X-ray alongside arterial blood gas analysis confirms Acute Respiratory Distress Syndrome (ARDS). A diagnosis of severe falciparum malaria is made. What is the treatment of choice?",
    options: [
      "Intravenous artesunate",
      "Intravenous clindamycin + oral artemether-lumefantrine",
      "Intravenous artemether-lumefantrine",
      "Oral atovaquone-proguanil",
      "Intravenous quinine"
    ],
    correctOption: "A",
    explanation: "Severe Falciparum Malaria: Defined by Plasmodium falciparum parasitemia combined with major organ dysfunction—such as ARDS (respiratory distress), cerebral malaria (confusion/drowsiness), acute kidney injury, or severe shock.\n\nTreatment of Choice: Intravenous (IV) Artesunate is the WHO-recommended first-line parenteral therapy for severe malaria in all patient populations (adults, children, and pregnant women). It rapidly reduces parasite load and significantly decreases mortality compared to IV quinine.\n\nRule-Outs:\n- Oral Regimens (Options B & D): Oral therapies (such as Atovaquone-Proguanil or Artemether-Lumefantrine) are strictly reserved for uncomplicated malaria and are inappropriate for patients with severe organ failure or altered mental status.\n- IV Quinine (Option E): Previously the historical standard of care, but now considered a second-line alternative due to a higher risk of adverse effects (e.g., hyperinsulinemic hypoglycemia and cinchonism) and inferior survival outcomes compared to IV Artesunate."
  },
  {
    id: "inf_w4_q10",
    text: "A 44-year-old farmer presents with a 1-week history of worsening fever, severe headache, and muscle aches. On review of systems, he reports nausea and a decreased urine output. Vital signs reveal a temperature of 38.2°C and a heart rate of 102/min. Physical examination shows bilateral subconjunctival hemorrhages, a completely clear chest on auscultation, and no evidence of jaundice. What is the most likely diagnosis?",
    options: [
      "Mycoplasma pneumonia",
      "Lyme disease",
      "Legionella pneumonia",
      "Listeria",
      "Leptospirosis"
    ],
    correctOption: "E",
    explanation: "Diagnosis: Occupational exposure (farmers, vets, sewage workers), flu-like illness (fever, myalgia, headache), subconjunctival hemorrhage (suffusion), and acute renal involvement (decreased urine output) are pathognomonic for Leptospirosis (Leptospira interrogans).\n\nKey Clinical Pearl: Jaundice is NOT required for diagnosis. Anicteric leptospirosis accounts for approximately 90% of all clinical cases, whereas severe icteric leptospirosis with hepatorenal failure (Weil's disease) occurs in only ~10% of patients.\n\nRule-Outs:\n- Mycoplasma & Legionella pneumonia: Unlikely due to the absence of respiratory symptoms, cough, or abnormal chest auscultation signs.\n- Lyme disease (Borrelia burgdorferi): Characterized by Erythema migrans (bullseye rash), migratory arthralgias, or AV heart block rather than subconjunctival hemorrhages and acute oliguric renal injury.\n- Listeria (L. monocytogenes): Typically presents as febrile gastroenteritis, bacteremia, or acute meningitis in neonates, elderly, or immunocompromised individuals."
  },
  {
    id: "inf_w4_q11",
    text: "A 20-year-old student presents to the Emergency Department three weeks after being scratched by their pet kitten on their left arm. Examination reveals a crusted papule at the site of the scratch and painful left axillary lymphadenopathy. Which is the most likely causative organism?",
    options: [
      "Bartonella",
      "Coxiella",
      "Brucella",
      "Mycoplasma",
      "Yersinia"
    ],
    correctOption: "A",
    explanation: "Diagnosis: Contact with kittens, presence of a primary lesion (crusted papule) at the inoculation site, and subacute, painful regional lymphadenopathy (left axilla) 1–3 weeks later is the classic presentation of Cat-Scratch Disease (CSD), caused by Bartonella henselae.\n\nRule-Outs:\n- Coxiella burnetii: Causative agent of Q fever; associated with exposure to infected farm animals or unpasteurized dairy, presenting with flu-like symptoms, pneumonia, hepatitis, or culture-negative endocarditis.\n- Brucella spp.: Causative agent of brucellosis; transmitted via unpasteurized dairy products or contact with livestock, presenting with undulant fever, hepatosplenomegaly, and sacroiliitis.\n- Mycoplasma pneumoniae: Primary cause of atypical 'walking' pneumonia with dry cough and tracheobronchitis.\n- Yersinia spp.: Y. enterocolitica causes acute gastroenteritis/pseudoappendicitis; Y. pestis causes plague with rapidly progressive buboes."
  },
  {
    id: "inf_w4_q12",
    text: "A 19-year-old man presents 3 days after returning from a backpacking trip across Brazil. He complains of sudden-onset fever, severe headache, muscle and joint pains, and a rash all over his body. On examination, he has a petechial rash on his limbs, with no focal neurological deficits and no signs of meningism.\nHb: 100 g/L | Platelets: 80 x 10^9/L (Thrombocytopenia) | WBC: 4.0 x 10^9/L (Leukopenia) | Eosinophils: 0.4 x 10^9/L (Normal)\nWhat is the most likely diagnosis?",
    options: [
      "Viral hepatitis",
      "Chagas disease",
      "Dengue fever",
      "Malaria",
      "Bacterial meningitis"
    ],
    correctOption: "C",
    explanation: "Diagnosis: Recent travel to an endemic tropical region (Brazil/South America), acute sudden-onset fever, severe arthralgias/myalgias ('breakbone fever'), petechial rash, and characteristic laboratory findings of thrombocytopenia and leukopenia are pathognomonic for Dengue fever (transmitted by Aedes aegypti mosquitoes).\n\nRule-Outs:\n- Chagas Disease (Trypanosoma cruzi): Also endemic to South America, but acute disease typically presents as a localized chagoma/Romaña sign with marked eosinophilia, rather than acute petechial hemorrhage.\n- Malaria: Typically presents with cyclical fevers and splenomegaly; a petechial rash is uncommon unless complicated by severe DIC.\n- Bacterial Meningitis: Excluded by the absence of neck stiffness (meningism), photophobia, or focal neurological signs.\n- Viral Hepatitis: Characterized primarily by prodromal fatigue, jaundice, dark urine, and markedly elevated transaminases rather than acute petechiae and severe bone/joint pain."
  },
  {
    id: "inf_w4_q13",
    text: "A 37-year-old sewer worker presents to the Emergency Department with flu-like symptoms and pyrexia for the past 3 days. Since this morning, he has developed a headache, and physical examination demonstrates signs of meningism.\nSodium: 130 mmol/L | Potassium: 4.7 mmol/L | Urea: 10.3 mmol/L | Creatinine: 133 µmol/L (Elevated / Acute Kidney Injury)\nWhat is the antibiotic treatment of choice?",
    options: [
      "Co-trimoxazole",
      "Ciprofloxacin",
      "Metronidazole",
      "Benzylpenicillin",
      "Erythromycin"
    ],
    correctOption: "D",
    explanation: "Diagnosis: Occupational exposure (sewer worker exposed to rodent urine), acute pyrexia, renal impairment, and central nervous system involvement (headache and meningism) are classic for severe Leptospirosis (Leptospira interrogans).\n\nTreatment of Choice: High-dose intravenous Benzylpenicillin G (or IV Ceftriaxone) is the drug of choice for severe leptospirosis, particularly when complicated by meningitis or acute renal failure.\n\nRule-Outs:\n- Oral Doxycycline / Amoxicillin: Used for mild, uncomplicated, outpatient anicteric leptospirosis, but inadequate for severe inpatient disease with neurological involvement.\n- Co-trimoxazole, Ciprofloxacin, Metronidazole, & Erythromycin (Options A, B, C, & E): Ineffective or not recommended as primary therapeutic agents for severe Leptospira infections."
  },
  {
    id: "inf_w4_q14",
    text: "What is the most common location of H. pylori-associated gastric ulcers?",
    options: [
      "Antrum",
      "Body",
      "Fundus",
      "Pylorus"
    ],
    correctOption: "A",
    explanation: "Anatomical Site: Helicobacter pylori predominantly colonizes the mucosal foveolar epithelium of the gastric antrum, as it is a less acidic microenvironment compared to the acid-secreting corpus/body. Consequently, H. pylori-associated non-erosive chronic active gastritis and benign gastric ulcers occur most frequently in the antrum (specifically along the lesser curvature near the incisura angularis).\n\nRule-Outs:\n- Body / Corpus (Option B): Corpus-predominant gastritis with multifocal mucosal atrophy occurs in a subset of patients (e.g., associated with prolonged proton pump inhibitor therapy or autoimmune gastritis), increasing the risk of gastric adenocarcinoma rather than typical antral peptic ulcers.\n- Fundus & Pylorus (Options C & D): The fundus contains dense parietal cell mass producing high local acid concentration, making primary H. pylori colonization less favorable; ulcers localized strictly to the pyloric channel (pyloric channel ulcers) are far less common than antral ulcers."
  },
  {
    id: "inf_w4_q15",
    text: "What is the most common clinical presentation of H. pylori infection?",
    options: [
      "Dyspepsia",
      "Abdominal pain",
      "Nausea and vomiting",
      "Diarrhea"
    ],
    correctOption: "A",
    explanation: "Symptomatic Presentation: While approximately 80–90% of individuals colonized with Helicobacter pylori remain entirely asymptomatic, dyspepsia (manifested as non-ulcer epigastric discomfort, postprandial fullness, belching, and early satiety) represents the single most common clinical presentation among patients who present with symptomatic disease.\n\nRule-Outs:\n- Abdominal pain (Option B): Mid-epigastric pain is a key feature of peptic ulcer disease (PUD), but generalized dyspepsia is a broader and significantly more prevalent clinical syndrome associated with H. pylori chronic active gastritis.\n- Nausea and vomiting (Option C): These are less frequent features, typically arising during acute gastritis flares or secondary to complications such as gastric outlet obstruction due to scarring.\n- Diarrhea (Option D): H. pylori specifically colonizes the lumen of the gastric mucosal epithelium and is not an etiologic cause of lower gastrointestinal disease or diarrhea."
  },
  {
    id: "inf_w4_q16",
    text: "A 25-year-old student with a documented severe anaphylactic allergy to egg protein is planning to travel to South East Asia. Which of the following vaccinations is contraindicated due to her egg allergy?",
    options: [
      "Yellow fever vaccine",
      "Typhoid vaccine",
      "Inactivated polio vaccine",
      "Japanese encephalitis vaccine",
      "Rabies vaccine"
    ],
    correctOption: "A",
    explanation: "Contraindication: The Yellow fever vaccine (along with yellow-fever-derived vector formulations) is produced in embryonated chicken eggs and contains clinically significant amounts of ovalbumin (egg protein). It is strictly contraindicated in individuals with a history of severe anaphylactic reaction to eggs unless evaluated and administered under specialist supervision (with skin testing or desensitization protocols).\n\nRule-Outs:\n- MMR & Rabies vaccines: Although chick embryo fibroblasts are used during production for MMR and certain rabies vaccines, egg protein residue is only present in negligible trace amounts (picogram to nanogram range) and is clinically safe for egg-allergic individuals.\n- Typhoid, IPV, & Japanese Encephalitis vaccines: These formulations do not rely on egg-based culture media and carry no risk of egg protein-induced hypersensitivity reactions."
  },
  {
    id: "inf_w4_q17",
    text: "A 30-year-old man presents to the acute medical receiving ward 1 week after returning from Tanzania. He has developed an abrupt high fever (38.9°C), severe headache, and debilitating generalized joint pain preventing him from walking, alongside a swollen finger joint. There is no rash, and he reports full adherence to his antimalarial chemoprophylaxis. Hb: 160 g/L | Platelets: 300 x 10^9/L (Normal) | WBC: 6.0 x 10^9/L (Normal)\nWhat is the most likely diagnosis?",
    options: [
      "Septic arthritis",
      "Malaria",
      "Chikungunya",
      "Zika",
      "Dengue"
    ],
    correctOption: "C",
    explanation: "Diagnosis: Abrupt onset of high fever, severe headache, and crippling polyarthralgia / dactylitis (swollen finger joint) following travel to East Africa (Tanzania) is classic for Chikungunya fever (an Alphavirus transmitted by Aedes mosquitoes). The name 'Chikungunya' originates from the Kimakonde language meaning 'that which bends up', describing the stooped posture assumed by patients due to severe joint pain.\n\nDistinguishing Arboviruses (Chikungunya vs. Dengue vs. Zika):\n- Chikungunya: Severe, painful joint swelling and polyarthralgia dominate the clinical picture. Complete blood count parameters (platelets and WBC) are typically normal or only minimally reduced, and skin rash is absent in up to 50% of cases.\n- Dengue: Dominated by retro-orbital pain, widespread maculopapular rash, and marked thrombocytopenia and leukopenia due to bone marrow suppression and vascular leakage.\n- Zika: Typically causes a milder illness characterized by prominent non-purulent conjunctivitis, maculopapular rash, low-grade fever, and mild transient arthralgias."
  },
  {
    id: "inf_w4_q18",
    text: "A 32-year-old traveler develops sudden focal ocular tissue damage during a systemic parasitic infection. Which of the following parasitic conditions represents 'Direct Damage' caused by the active pathogen itself?",
    options: [
      "Giardiasis",
      "Visceral Larva Migrans",
      "Fascioliasis in the anterior chamber",
      "Onchocerciasis"
    ],
    correctOption: "B",
    explanation: "Pathological Mechanism: Visceral Larva Migrans (Toxocariasis) causes Direct Damage as migrating larvae invade and physically disrupt ocular tissue layers.\n\nEctopic Parasitism: Fasciola residing in the eye represents Ectopic Parasitism (parasite situated outside its normal habitat).\n\nIndirect & Immune Mechanisms: Giardiasis causes Indirect Damage via toxic/metabolic products, whereas Onchocerca volvulus lesions are driven by severe host Immune Responses to dying microfilariae."
  },
  {
    id: "inf_w4_q19",
    text: "A 24-year-old soft contact lens user presents with excruciating left eye pain out of proportion to exam findings, photophobia, and a characteristic ring-shaped corneal infiltrate. What is the recommended medical therapy for this infection?",
    options: [
      "Topical Acyclovir and systemic Corticosteroids",
      "Itraconazole / Miconazole (or corneal transplant in refractory cases)",
      "Oral Diethylcarbamazine (DEC)",
      "Ivermectin and Doxycycline"
    ],
    correctOption: "B",
    explanation: "Diagnosis: Acanthamoeba Keratitis (free-living amoeba acquired via improper contact lens care or swimming in contaminated water).\n\nPathognomonic Signs: Severe pain out of proportion to signs, conjunctival edema, and a classic ring infiltrate surrounding the cornea.\n\nManagement & Complications: Treated with Itraconazole or Miconazole; corneal transplantation is indicated for severe corneal perforation or endophthalmitis (particularly in AIDS patients)."
  },
  {
    id: "inf_w4_q20",
    text: "A traveler returning from an endemic tropical region presents with high fever, diffuse petechiae, and mucosal bleeding. Laboratory tests show elevated liver enzymes, marked thrombocytopenia, and capillary leak. Which medication class is STRICTLY CONTRAINDICATED?",
    options: [
      "Intravenous isotonic crystalloids",
      "Aspirin and Non-Steroidal Anti-inflammatory Drugs (NSAIDs)",
      "Oral Acetaminophen (Paracetamol)",
      "Empiric IV Ceftriaxone"
    ],
    correctOption: "B",
    explanation: "Pathophysiology: VHFs involve viral replication in macrophages/monocytes and endothelial cells, triggering a massive cytokine storm and severe vascular endothelial damage (increased permeability).\n\nContraindicated Medications: Aspirin, NSAIDs, and anticoagulants are strictly contraindicated in all VHFs as they inhibit platelet function and exacerbate severe internal/gastrointestinal bleeding.\n\nSupportive Care: Acetaminophen may be used cautiously for fever, and IV fluids are required for vascular collapse."
  },
  {
    id: "inf_w4_q21",
    text: "A 30-year-old unvaccinated traveler returning from South America experiences a 3-day febrile illness followed by a 36-hour period of apparent clinical remission ('period of calm'). He then abruptly decompensates with deep jaundice, oliguria, and hematemesis ('black vomit'). What is the diagnosis?",
    options: [
      "Lassa fever",
      "Yellow fever",
      "Crimean-Congo hemorrhagic fever",
      "Hantavirus pulmonary syndrome"
    ],
    correctOption: "B",
    explanation: "Pathognomonic Biphasic Course: Yellow fever (Flaviviridae, transmitted by Aedes mosquitoes) classically exhibits an initial viremic phase, a 24–48 hour 'period of calm', followed by a toxic secondary phase in 15–25% of cases.\n\nToxic Phase Features: Characterized by severe hepatic necrosis (deep jaundice), acute renal failure (oliguria), and gastric mucosal hemorrhage resulting in black vomit (hematemesis).\n\nPrevention: Preventable via a single dose of 17D live attenuated Yellow Fever vaccine."
  },
  {
    id: "inf_w4_q22",
    text: "A livestock farmer presents with abrupt fever, severe headache, back pain, and massive subcutaneous ecchymosis localized to his left upper extremity. History reveals he removed Hyalomma ticks from his cattle with bare hands. What is the pathogen?",
    options: [
      "Crimean-Congo Hemorrhagic Fever virus",
      "Rift Valley Fever virus",
      "Dengue virus type 4",
      "Ebola Zaire virus"
    ],
    correctOption: "A",
    explanation: "Vector & Etiology: Crimean-Congo Hemorrhagic Fever (CCHF) is a Bunyavirus transmitted primarily by Hyalomma hard ticks or direct contact with infected livestock blood/tissues.\n\nDistinctive Clinical Sign: Classically associated with severe liver necrosis, massive subcutaneous ecchymosis (often noted on extremities), and mucosal bleeding.\n\nManagement: High-risk exposure protocols, supportive care, and consideration of early oral/IV Ribavirin."
  },
  {
    id: "inf_w4_q23",
    text: "A 45-year-old patient with chronic epigastric pain undergoes gastric mucosal biopsy. Histology reveals motile, microaerophilic, spiral Gram-negative bacilli that are Urease positive. How does urease facilitate bacterial colonization in gastric juice?",
    options: [
      "It directly degrades gastric mucin disulfide bonds",
      "It breaks down urea into ammonia and CO2, creating a protective alkaline microenvironment",
      "It inhibits parietal cell hydrogen-potassium ATPase pumps",
      "It induces complete achlorhydria via gastric mucosal atrophy"
    ],
    correctOption: "B",
    explanation: "Microbiology & Virulence: Helicobacter pylori is a motile, spiral, microaerophilic Gram-negative bacillus with unipolar flagella.\n\nUrease Action: Urease cleaves gastric urea into carbon dioxide and Ammonia (NH3). Ammonia is a strong base that neutralizes stomach acid immediately around the bacterium, creating a favorable microenvironment allowing passage to foveolar epithelial cells.\n\nVirulence Factors: CagA (cytotoxin-associated gene A) induces IL-8 release and is strongly linked to gastric cancer and MALT lymphoma."
  },
  {
    id: "inf_w4_q24",
    text: "During esophagogastroduodenoscopy (EGD), antral mucosal biopsy specimens are placed into a urea-containing gel medium containing a phenol red pH indicator (Rapid Urease Test / CLO test). What color change signifies a positive result?",
    options: [
      "Yellow to Pink / Red",
      "Blue to Clear",
      "Green to Dark Brown",
      "Colorless to Bright Yellow"
    ],
    correctOption: "A",
    explanation: "Invasive Diagnostic Tests: Rapid Urease Test (RUT/CLO test) utilizes endoscopic mucosal biopsies placed in urea gel with a pH indicator.\n\nColor Shift Mechanism: Bacterial urease converts urea to ammonia -> rises pH -> changes pH indicator color from Yellow (acidic) to Pink/Red (alkaline). Provides fast results (minutes to 24h).\n\nGold Standard Invasive Test: Histology using Modified Giemsa or Silver stain is the gold standard for biopsy verification."
  },
  {
    id: "inf_w4_q25",
    text: "A 30-year-old kayaker presents with mild anicteric leptospirosis without jaundice or renal impairment. What is the preferred 1st-line outpatient oral antibiotic regimen?",
    options: [
      "Oral Doxycycline 100 mg twice daily for 5-7 days (or oral Azithromycin)",
      "Intravenous Vancomycin for 14 days",
      "Oral Metronidazole 500 mg thrice daily",
      "Oral Chloramphenicol monotherapy"
    ],
    correctOption: "A",
    explanation: "Mild Anicteric Regimen: Outpatient management of mild anicteric leptospirosis utilizes oral Doxycycline (100 mg BID for 5–7 days) or oral Azithromycin / Amoxicillin.\n\nCo-Endemic Advantage: Doxycycline and Azithromycin are the drugs of choice in regions co-endemic for Rickettsia and Leptospira."
  },
  {
    id: "inf_w4_q26",
    text: "A 26-year-old pregnant female at 18 weeks gestation contracts mild anicteric leptospirosis following exposure to floodwaters. Which antibiotic is preferred to avoid fetal musculoskeletal and dental toxicity?",
    options: [
      "Oral Doxycycline",
      "Oral Amoxicillin or Azithromycin",
      "Oral Ciprofloxacin",
      "Oral Co-Trimoxazole"
    ],
    correctOption: "B",
    explanation: "Pregnancy Considerations: Doxycycline is strictly contraindicated in pregnancy (<8 years of age) due to fetal tooth discoloration and bone growth inhibition.\n\nPreferred Regimen: Amoxicillin or Azithromycin (or Erythromycin in penicillin allergy) is the drug of choice for leptospirosis in pregnant women and young children."
  },
  {
    id: "inf_w4_q27",
    text: "A 14-year-old girl has moderate tender axillary lymphadenopathy due to CSD. She was started on Amoxicillin 7 days ago with no improvement. Serology confirms Bartonella henselae. What is the recommended 1st-line antibiotic regimen to shorten lymph node resolution time?",
    options: [
      "Continue Amoxicillin at a higher dose for 21 days",
      "A 5-day course of oral Azithromycin",
      "Intravenous Vancomycin and Meropenem",
      "Oral Fluconazole for 6 weeks"
    ],
    correctOption: "B",
    explanation: "Antibiotic Efficacy: Amoxicillin is characteristically ineffective against Bartonella henselae.\n\nRecommended Regimen: While uncomplicated CSD is self-limiting, when pharmacological therapy is indicated to accelerate lymph node healing, a 5-day course of oral Azithromycin is the drug of choice.\n\nAlternative Options: Doxycycline or Erythromycin may be used as alternatives in adults."
  },
  {
    id: "inf_w4_q28",
    text: "31-year-old traveler returning from Southeast Asia presents with acute fever, severe retro-orbital pain, and intense arthralgia ('breakbone fever'). Which initial combination of routine laboratory findings strongly suggests an early viral hemorrhagic fever like Dengue?",
    options: [
      "Leukocytosis (>15,000) and Thrombocytosis (>500,000)",
      "Thrombocytopenia and Leukopenia",
      "Isolated Eosinophilia (>20%)",
      "Marked Polycythemia with normal platelets"
    ],
    correctOption: "B",
    explanation: "Laboratory Signature: Early viral hemorrhagic fevers (especially Dengue and Filoviruses) characteristically present with simultaneous Leukopenia (due to bone marrow suppression) and Thrombocytopenia (due to peripheral consumption and endothelial binding).\n\nHematocrit Trends: Plasma leakage later causes hemoconcentration (elevated hematocrit), serving as a monitoring marker for fluid replacement."
  },
  {
    id: "inf_w4_q29",
    text: "A forest ranger presents with acute fever, severe lumbar back pain, subconjunctival hemorrhages, oliguria, and marked proteinuria following cleanup of a rodent-infested cabin. Which specific viral syndrome is demonstrated?",
    options: [
      "Hantavirus Pulmonary Syndrome (HPS)",
      "Hemorrhagic Fever with Renal Syndrome (HFRS)",
      "Yellow Fever toxic phase",
      "Dengue Shock Syndrome"
    ],
    correctOption: "B",
    explanation: "Etiology & Transmission: Old World Hantaviruses (Bunyaviridae) are transmitted via inhalation of aerosolized rodent excreta (urine/feces).\n\nHFRS Features: Causes Hemorrhagic Fever with Renal Syndrome (HFRS), marked by fever, severe flank/back pain, vascular leak, retroperitoneal edema, proteinuria, and oliguric acute renal failure.\n\nHPS Comparison: New World Hantaviruses cause Hantavirus Pulmonary Syndrome (HPS), presenting with non-cardiogenic pulmonary edema and severe hypoxemia."
  },
  {
    id: "inf_w4_q30",
    text: "26-year-old female with Dengue fever presents on day 5 of illness as her fever breaks. She develops severe persistent abdominal pain, persistent vomiting, mucosal bleeding, and hepatomegaly (>2 cm). Blood tests show a rapid rise in hematocrit paired with a sudden plummet in platelet count. How is her disease classified?",
    options: [
      "Group A (Outpatient management)",
      "Dengue with Warning Signs (Group B - Inpatient management)",
      "Uncomplicated Dengue fever",
      "Post-viral fatigue syndrome"
    ],
    correctOption: "B",
    explanation: "Dengue Triage: Group A = No warning signs (outpatient). Group B = Warning signs present or co-existing conditions (inpatient). Group C = Severe Dengue (shock, fluid accumulation, ARDS, severe organ failure - ICU).\n\nWarning Signs Criteria: Severe abdominal pain, persistent vomiting, mucosal bleeding, hepatomegaly >2 cm, fluid accumulation, lethargy, and rapid hematocrit rise with platelet drop.\n\nClinical Importance: The defervescence phase (days 3–7) is the critical window where capillary leak and shock develop."
  }
];

const quizPayload = {
  id: "quiz_fourth_week_exam_infection",
  title: "Fourth Week Exam",
  group_name: "infection",
  start_time: "2026-10-16T18:00:00.000Z", // 21:00 Cairo Time (UTC+3)
  end_time: "2026-10-16T18:40:00.000Z",   // 21:40 Cairo Time (UTC+3)
  time_limit: 30,
  status: "active",
  questions: questions
};

async function main() {
  console.log("=== PUSHING FOURTH WEEK EXAM TO SUPABASE ===");
  console.log(`Title: ${quizPayload.title}`);
  console.log(`Course Group: ${quizPayload.group_name}`);
  console.log(`Start Time: ${quizPayload.start_time} (Cairo Local: 21:00 / 9:00 PM)`);
  console.log(`End Time: ${quizPayload.end_time} (Cairo Local: 21:40 / 9:40 PM)`);
  console.log(`Time Limit: ${quizPayload.time_limit} minutes`);
  console.log(`Questions Count: ${quizPayload.questions.length}`);

  // Insert or Upsert
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hawari_course_quizzes`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify(quizPayload)
  });

  console.log("HTTP Status:", res.status);
  if (res.ok || res.status === 201 || res.status === 200 || res.status === 204) {
    console.log("SUCCESSFULLY INSERTED / MERGED Fourth Week Exam!");
  } else {
    console.error("Failed response:", await res.text());
    process.exit(1);
  }

  // Verification from cloud
  console.log("\nVerifying from cloud...");
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/hawari_course_quizzes?id=eq.quiz_fourth_week_exam_infection`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
  });
  const data = await checkRes.json();
  if (data && data.length > 0) {
    const qz = data[0];
    console.log("=============================================");
    console.log("🎉 FOURTH WEEK EXAM IS OFFICIALLY LIVE IN SUPABASE!");
    console.log("=============================================");
    console.log("  ID:", qz.id);
    console.log("  Title:", qz.title);
    console.log("  Start Time:", qz.start_time);
    console.log("  End Time:", qz.end_time);
    console.log("  Time Limit:", qz.time_limit, "minutes");
    console.log("  Status:", qz.status);
    console.log("  Total Questions Count:", qz.questions?.length);
  } else {
    console.error("Quiz not found after insertion!");
    process.exit(1);
  }
}

main().catch(console.error);
